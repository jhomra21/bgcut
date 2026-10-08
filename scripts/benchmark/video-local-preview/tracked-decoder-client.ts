import { Match } from "effect";
import {
  createVideoSegmentationAdapter,
} from "../video-segmentation/adapter";
import {
  VIDEO_SEGMENTATION_CANDIDATES,
} from "../video-segmentation/candidates";
import {
  openMediaBunnyVideoSource,
} from "../video-segmentation/media-source";
import {
  QUALITY_FRAME_COUNT,
  QUALITY_FRAME_RATE,
  type QualityFixtureId,
} from "../video-segmentation/quality-fixture";
import {
  binaryMaskIou,
  davisBoundaryF,
} from "../video-segmentation/quality-metrics";

import type {
  VideoSegmentationMask,
} from "../video-segmentation/types";

type TruthMask = {
  readonly mask:
    Uint8Array;
  readonly width:
    number;
  readonly height:
    number;
};

type PositivePoint = {
  readonly x: number;
  readonly y: number;
  readonly label: 1;
};

const FIXTURES =
  [
    "bear",
    "blackswan",
    "camel",
    "car-shadow",
  ] as const satisfies
    readonly QualityFixtureId[];

const SPECIALIZED_DECODER =
  "/specialized/sam21-tracked-mask-decoder.onnx";

const SPECIALIZED_MEMORY_ENCODER =
  "/specialized/sam21-tracked-memory-encoder.onnx";

const SPECIALIZED_TRACKED_STEP =
  "/specialized/sam21-tracked-step.onnx";

type TrackerVariant =
  | "baseline"
  | "decoder"
  | "decoder-memory"
  | "fused-step";

const VARIANT_ORDER_BY_FIXTURE = {
  bear: [
    "baseline",
    "decoder",
    "decoder-memory",
    "fused-step",
  ],
  blackswan: [
    "decoder",
    "decoder-memory",
    "fused-step",
    "baseline",
  ],
  camel: [
    "decoder-memory",
    "fused-step",
    "baseline",
    "decoder",
  ],
  "car-shadow": [
    "fused-step",
    "baseline",
    "decoder",
    "decoder-memory",
  ],
} as const satisfies
  Readonly<
    Record<
      (typeof FIXTURES)[number],
      readonly TrackerVariant[]
    >
  >;

const truthMask = async (
  fixture:
    QualityFixtureId,
  frameIndex: number,
): Promise<TruthMask> => {
  const response =
    await fetch(
      `/quality/${fixture}/${frameIndex
        .toString()
        .padStart(
          5,
          "0",
        )}.png`,
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Could not load ${fixture} truth frame ${frameIndex}: HTTP ${response.status}.`,
    );
  }

  const bitmap =
    await createImageBitmap(
      await response.blob(),
    );

  try {
    const canvas =
      document.createElement(
        "canvas",
      );

    canvas.width =
      bitmap.width;
    canvas.height =
      bitmap.height;

    const context =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        },
      );

    if (
      context ===
      null
    ) {
      throw new Error(
        "Could not inspect DAVIS truth mask.",
      );
    }

    context.drawImage(
      bitmap,
      0,
      0,
    );

    const pixels =
      context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;

    return {
      width:
        canvas.width,
      height:
        canvas.height,
      mask:
        Uint8Array.from(
          {
            length:
              canvas.width *
              canvas.height,
          },
          (
            _,
            index,
          ) =>
            (
              pixels[
                index *
                  4
              ] ??
              0
            ) >
            0
              ? 1
              : 0,
        ),
    };
  } finally {
    bitmap.close();
  }
};

const pointFromTruth = (
  truth:
    TruthMask,
): PositivePoint => {
  let foreground =
    0;

  let sumX =
    0;

  let sumY =
    0;

  for (
    let y = 0;
    y <
    truth.height;
    y += 1
  ) {
    for (
      let x = 0;
      x <
      truth.width;
      x += 1
    ) {
      if (
        (
          truth.mask[
            y *
              truth.width +
              x
          ] ??
          0
        ) ===
        0
      ) {
        continue;
      }

      foreground +=
        1;

      sumX +=
        x;

      sumY +=
        y;
    }
  }

  if (
    foreground ===
    0
  ) {
    throw new Error(
      "DAVIS truth mask has no foreground.",
    );
  }

  const centerX =
    sumX /
    foreground;

  const centerY =
    sumY /
    foreground;

  let selectedX =
    0;

  let selectedY =
    0;

  let selectedDistance =
    Number.POSITIVE_INFINITY;

  for (
    let y = 0;
    y <
    truth.height;
    y += 1
  ) {
    for (
      let x = 0;
      x <
      truth.width;
      x += 1
    ) {
      if (
        (
          truth.mask[
            y *
              truth.width +
              x
          ] ??
          0
        ) ===
        0
      ) {
        continue;
      }

      const distance =
        (
          x -
          centerX
        ) **
          2 +
        (
          y -
          centerY
        ) **
          2;

      if (
        distance <
        selectedDistance
      ) {
        selectedDistance =
          distance;

        selectedX =
          x;

        selectedY =
          y;
      }
    }
  }

  return {
    x:
      (
        selectedX +
        0.5
      ) /
      truth.width,
    y:
      (
        selectedY +
        0.5
      ) /
      truth.height,
    label: 1,
  };
};

const score = (
  prediction:
    VideoSegmentationMask,
  truth:
    TruthMask,
) => {
  const predicted =
    Uint8Array.from(
      {
        length:
          truth.width *
          truth.height,
      },
      (
        _,
        index,
      ) => {
        const x =
          Math.min(
            prediction.width -
              1,
            Math.floor(
              (
                index %
                truth.width
              ) *
                prediction.width /
                truth.width,
            ),
          );

        const y =
          Math.min(
            prediction.height -
              1,
            Math.floor(
              Math.floor(
                index /
                  truth.width,
              ) *
                prediction.height /
                truth.height,
            ),
          );

        return (
          prediction.logits[
            y *
              prediction.width +
              x
          ] ??
          Number.NEGATIVE_INFINITY
        ) >
        0
          ? 1
          : 0;
      },
    );

  return {
    iou:
      binaryMaskIou(
        predicted,
        truth.mask,
      ),
    boundaryF:
      davisBoundaryF(
        predicted,
        truth.mask,
        truth.width,
        truth.height,
      ),
  };
};

const mean = (
  values:
    readonly number[],
): number =>
  values.reduce(
    (
      total,
      value,
    ) =>
      total +
      value,
    0,
  ) /
  values.length;

const runTracker = async (
  fixture:
    QualityFixtureId,
  file: File,
  truths:
    readonly TruthMask[],
  point:
    PositivePoint,
  variant:
    TrackerVariant,
) => {
  const source =
    await openMediaBunnyVideoSource(
      file,
    );

  const adapterOptions =
    Match.value(
      variant,
    ).pipe(
      Match.when(
        "baseline",
        () =>
          undefined,
      ),
      Match.when(
        "fused-step",
        () => ({
          trackedStepUrl:
            SPECIALIZED_TRACKED_STEP,
        }),
      ),
      Match.when(
        "decoder-memory",
        () => ({
          trackedMaskDecoderUrl:
            SPECIALIZED_DECODER,
          trackedMemoryEncoderUrl:
            SPECIALIZED_MEMORY_ENCODER,
        }),
      ),
      Match.when(
        "decoder",
        () => ({
          trackedMaskDecoderUrl:
            SPECIALIZED_DECODER,
        }),
      ),
      Match.exhaustive,
    );

  const adapter =
    await createVideoSegmentationAdapter(
      VIDEO_SEGMENTATION_CANDIDATES[
        "sam21-tiny"
      ],
      undefined,
      adapterOptions,
    );

  try {
    const loadStarted =
      performance.now();

    await adapter.prepareTracking?.();

    const trackingPrepareMs =
      performance.now() -
      loadStarted;

    const timestamps =
      (
        await source.frameTimes(
          source.info.firstTimestamp,
          source.info.firstTimestamp +
            Math.min(
              1,
              source.info.duration,
            ),
          QUALITY_FRAME_RATE,
        )
      ).slice(
        0,
        QUALITY_FRAME_COUNT,
      );

    if (
      timestamps.length !==
      truths.length
    ) {
      throw new Error(
        `${fixture} exposed ${timestamps.length} frames but ${truths.length} truth masks were loaded.`,
      );
    }

    const seedTimestamp =
      timestamps[0];

    if (
      seedTimestamp ===
      undefined
    ) {
      throw new Error(
        `${fixture} has no seed timestamp.`,
      );
    }

    const seedFrame =
      await source.frameAt(
        seedTimestamp,
      );

    if (
      seedFrame ===
      null
    ) {
      throw new Error(
        `Could not decode ${fixture} seed frame.`,
      );
    }

    const scores: {
      readonly iou: number;
      readonly boundaryF:
        number;
    }[] = [];

    let seedMs =
      0;

    let trackingMs =
      0;

    try {
      const started =
        performance.now();

      const seed =
        await adapter.seed(
          seedFrame.frame,
          {
            points: [
              point,
            ],
          },
          0,
          timestamps.length,
        );

      seedMs =
        performance.now() -
        started;

      const truth =
        truths[0];

      if (
        truth ===
        undefined
      ) {
        throw new Error(
          "Missing seed truth mask.",
        );
      }

      scores.push(
        score(
          seed,
          truth,
        ),
      );
    } finally {
      seedFrame.close();
    }

    let frameIndex =
      1;

    for await (
      const decoded of
      source.framesAt(
        timestamps.slice(
          1,
        ),
      )
    ) {
      if (
        decoded ===
        null
      ) {
        throw new Error(
          `Could not decode ${fixture} frame ${frameIndex}.`,
        );
      }

      try {
        const started =
          performance.now();

        const mask =
          await adapter.track(
            decoded.frame,
            frameIndex,
            timestamps.length,
          );

        trackingMs +=
          performance.now() -
          started;

        const truth =
          truths[
            frameIndex
          ];

        if (
          truth ===
          undefined
        ) {
          throw new Error(
            `Missing ${fixture} truth frame ${frameIndex}.`,
          );
        }

        scores.push(
          score(
            mask,
            truth,
          ),
        );
      } finally {
        decoded.close();
      }

      frameIndex +=
        1;
    }

    return {
      variant,
      trackingPrepareMs,
      seedMs,
      trackingMs,
      trackingFps:
        (
          scores.length -
          1
        ) /
        (
          trackingMs /
          1000
        ),
      meanIou:
        mean(
          scores.map(
            (
              value,
            ) =>
              value.iou,
          ),
        ),
      worstIou:
        Math.min(
          ...scores.map(
            (
              value,
            ) =>
              value.iou,
          ),
        ),
      meanBoundaryF:
        mean(
          scores.map(
            (
              value,
            ) =>
              value.boundaryF,
          ),
        ),
      worstBoundaryF:
        Math.min(
          ...scores.map(
            (
              value,
            ) =>
              value.boundaryF,
          ),
        ),
      graphTimings:
        adapter.timingSnapshot?.(),
    };
  } finally {
    source.close();

    await adapter.close();
  }
};

const pointInHalf = (
  truth: TruthMask,
  right: boolean,
): PositivePoint => {
  const midpoint =
    truth.width /
    2;

  let count = 0;
  let sumX = 0;
  let sumY = 0;

  for (
    let y = 0;
    y < truth.height;
    y += 1
  ) {
    for (
      let x = 0;
      x < truth.width;
      x += 1
    ) {
      if (
        (x >= midpoint) !==
          right ||
        (truth.mask[
          y * truth.width + x
        ] ?? 0) === 0
      ) {
        continue;
      }

      count += 1;
      sumX += x;
      sumY += y;
    }
  }

  if (count < 32) {
    throw new Error(
      "BMX foreground cannot provide two separated subject points.",
    );
  }

  const centerX =
    sumX / count;

  const centerY =
    sumY / count;

  let bestX = 0;
  let bestY = 0;

  let bestDistance =
    Number.POSITIVE_INFINITY;

  for (
    let y = 0;
    y < truth.height;
    y += 1
  ) {
    for (
      let x = 0;
      x < truth.width;
      x += 1
    ) {
      if (
        (x >= midpoint) !==
          right ||
        (truth.mask[
          y * truth.width + x
        ] ?? 0) === 0
      ) {
        continue;
      }

      const distance =
        (x - centerX) ** 2 +
        (y - centerY) ** 2;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestX = x;
        bestY = y;
      }
    }
  }

  return {
    x:
      (bestX + 0.5) /
      truth.width,
    y:
      (bestY + 0.5) /
      truth.height,
    label: 1,
  };
};

const runMultiSubjectTracker = async (
  file: File,
  truth: TruthMask,
  variant:
    "baseline" |
    "fused-step",
) => {
  const left =
    pointInHalf(truth, false);

  const right =
    pointInHalf(truth, true);

  const subjects = [
    {
      id: "left",
      prompt: {
        points: [
          left,
          {
            x: right.x,
            y: right.y,
            label: 0 as const,
          },
        ],
      },
    },
    {
      id: "right",
      prompt: {
        points: [
          right,
          {
            x: left.x,
            y: left.y,
            label: 0 as const,
          },
        ],
      },
    },
  ];

  const source =
    await openMediaBunnyVideoSource(
      file,
    );

  const adapter =
    await createVideoSegmentationAdapter(
      VIDEO_SEGMENTATION_CANDIDATES[
        "sam21-tiny"
      ],
      undefined,
      variant === "fused-step"
        ? {
            trackedStepUrl:
              SPECIALIZED_TRACKED_STEP,
          }
        : undefined,
    );

  try {
    await adapter.prepareTracking?.();

    if (
      adapter.seedSubjects ===
        undefined ||
      adapter.trackSubjects ===
        undefined ||
      adapter.rewindSubjects ===
        undefined
    ) {
      throw new Error(
        "SAM 2.1 multi-subject tracking is unavailable.",
      );
    }

    const timestamps =
      (
        await source.frameTimes(
          source.info.firstTimestamp,
          source.info.firstTimestamp +
            Math.min(
              1,
              source.info.duration,
            ),
          QUALITY_FRAME_RATE,
        )
      ).slice(
        0,
        QUALITY_FRAME_COUNT,
      );

    if (
      timestamps.length !==
      QUALITY_FRAME_COUNT
    ) {
      throw new Error(
        "BMX multi-subject acceptance needs the full labeled frame window.",
      );
    }

    const seedIndex = 5;

    const masksByFrame:
      (readonly Uint8Array[] |
        undefined)[] =
      Array.from({
        length:
          timestamps.length,
      });

    let trackingMs = 0;

    const capture = async (
      index: number,
      seed: boolean,
    ) => {
      const timestamp =
        timestamps[index];

      if (
        timestamp ===
        undefined
      ) {
        throw new Error(
          `Missing BMX timestamp at ${index}.`,
        );
      }

      const decoded =
        await source.frameAt(
          timestamp,
        );

      if (
        decoded === null
      ) {
        throw new Error(
          `Could not decode BMX frame ${index}.`,
        );
      }

      try {
        const started =
          performance.now();

        const masks =
          seed
            ? await adapter.seedSubjects!(
                decoded.frame,
                subjects,
                index,
                timestamps.length,
              )
            : await adapter.trackSubjects!(
                decoded.frame,
                index,
                timestamps.length,
              );

        trackingMs +=
          performance.now() -
          started;

        if (masks.length !== 2) {
          throw new Error(
            `Expected two tracked subject masks at frame ${index}.`,
          );
        }

        masksByFrame[index] =
          masks.map(
            (mask) =>
              Uint8Array.from(
                mask.logits,
                (value) =>
                  value > 0 ? 1 : 0,
              ),
          );
      } finally {
        decoded.close();
      }
    };

    await capture(
      seedIndex,
      true,
    );

    for (
      let index = seedIndex + 1;
      index < timestamps.length;
      index += 1
    ) {
      await capture(
        index,
        false,
      );
    }

    adapter.rewindSubjects();

    for (
      let index = seedIndex - 1;
      index >= 0;
      index -= 1
    ) {
      await capture(
        index,
        false,
      );
    }

    if (
      masksByFrame.some(
        (masks) =>
          masks === undefined,
      )
    ) {
      throw new Error(
        "Multi-subject tracking skipped a forward or backward frame.",
      );
    }

    return {
      variant,
      subjects,
      seedIndex,
      trackingMs,
      masksByFrame,
    };
  } finally {
    source.close();
    await adapter.close();
  }
};

const compareMultiSubjectTracking =
  async () => {
    const response =
      await fetch(
        "/quality/bmx-trees.mp4",
      );

    if (!response.ok) {
      throw new Error(
        `Could not load BMX video: HTTP ${response.status}.`,
      );
    }

    const file =
      new File(
        [await response.blob()],
        "bmx-trees.mp4",
      );

    const truth =
      await truthMask(
        "bmx-trees",
        5,
      );

    const baseline =
      await runMultiSubjectTracker(
        file,
        truth,
        "baseline",
      );

    const fused =
      await runMultiSubjectTracker(
        file,
        truth,
        "fused-step",
      );

    const frameScores: {
      readonly frame: number;
      readonly subject: number;
      readonly iou: number;
      readonly baselinePixels: number;
      readonly fusedPixels: number;
    }[] = [];

    for (
      let index = 0;
      index <
      QUALITY_FRAME_COUNT;
      index += 1
    ) {
      const baselineMasks =
        baseline.masksByFrame[
          index
        ];

      const fusedMasks =
        fused.masksByFrame[
          index
        ];

      if (
        baselineMasks ===
          undefined ||
        fusedMasks ===
          undefined
      ) {
        throw new Error(
          `Missing multi-subject comparison frame ${index}.`,
        );
      }

      for (
        let subjectIndex = 0;
        subjectIndex < 2;
        subjectIndex += 1
      ) {
        const expected =
          baselineMasks[
            subjectIndex
          ];

        const actual =
          fusedMasks[
            subjectIndex
          ];

        if (
          expected ===
            undefined ||
          actual ===
            undefined ||
          expected.length !==
            actual.length
        ) {
          throw new Error(
            `Multi-subject mask geometry changed at frame ${index}.`,
          );
        }

        const iou =
          binaryMaskIou(
            actual,
            expected,
          );

        frameScores.push({
          frame: index,
          subject:
            subjectIndex + 1,
          iou,
          baselinePixels:
            expected.reduce(
              (sum, pixel) =>
                sum + pixel,
              0,
            ),
          fusedPixels:
            actual.reduce(
              (sum, pixel) =>
                sum + pixel,
              0,
            ),
        });
      }
    }

    const meanIou =
      mean(
        frameScores.map(
          (item) =>
            item.iou,
        ),
      );

    const worstIou =
      Math.min(
        ...frameScores.map(
          (item) =>
            item.iou,
        ),
      );

    if (
      meanIou < 0.995 ||
      worstIou < 0.98
    ) {
      throw new Error(
        `Fused multi-subject parity needs review: mean ${meanIou.toFixed(4)}, worst ${worstIou.toFixed(4)}. Frames: ${JSON.stringify(frameScores)}`,
      );
    }

    return {
      fixture:
        "bmx-trees",
      seedIndex:
        baseline.seedIndex,
      subjects:
        baseline.subjects,
      frameCount:
        QUALITY_FRAME_COUNT,
      meanParityIou:
        meanIou,
      worstParityIou:
        worstIou,
      frameScores,
      baselineTrackingMs:
        baseline.trackingMs,
      fusedTrackingMs:
        fused.trackingMs,
    };
  };

const main = async () => {
  const multiSubject =
    await compareMultiSubjectTracking();

  const cases =
    [];

  for (
    const fixture of
    FIXTURES
  ) {
    const videoResponse =
      await fetch(
        `/quality/${fixture}.mp4`,
      );

    if (
      !videoResponse.ok
    ) {
      throw new Error(
        `Could not load ${fixture} video: HTTP ${videoResponse.status}.`,
      );
    }

    const file =
      new File(
        [
          await videoResponse.blob(),
        ],
        `${fixture}.mp4`,
      );

    const truths =
      await Promise.all(
        Array.from(
          {
            length:
              QUALITY_FRAME_COUNT,
          },
          (
            _,
            index,
          ) =>
            truthMask(
              fixture,
              index,
            ),
        ),
      );

    const point =
      pointFromTruth(
        truths[0]!,
      );

    const order =
      VARIANT_ORDER_BY_FIXTURE[
        fixture
      ];

    const results =
      new Map<
        TrackerVariant,
        Awaited<
          ReturnType<
            typeof runTracker
          >
        >
      >();

    for (
      const variant of
      order
    ) {
      results.set(
        variant,
        await runTracker(
          fixture,
          file,
          truths,
          point,
          variant,
        ),
      );
    }

    const requireResult = (
      variant:
        TrackerVariant,
    ) => {
      const result =
        results.get(
          variant,
        );

      if (
        result ===
        undefined
      ) {
        throw new Error(
          `Missing ${fixture} ${variant} result.`,
        );
      }

      return result;
    };

    const baseline =
      requireResult(
        "baseline",
      );

    const decoder =
      requireResult(
        "decoder",
      );

    const decoderMemory =
      requireResult(
        "decoder-memory",
      );

    const fusedStep =
      requireResult(
        "fused-step",
      );

    const compare = (
      candidate:
        typeof decoder,
    ) => {
      const meanIouDelta =
        candidate.meanIou -
        baseline.meanIou;

      const meanBoundaryDelta =
        candidate.meanBoundaryF -
        baseline.meanBoundaryF;

      if (
        Math.abs(
          meanIouDelta,
        ) >
          0.005 ||
        Math.abs(
          meanBoundaryDelta,
        ) >
          0.005 ||
        candidate.worstIou <
          baseline.worstIou -
            0.01 ||
        candidate.worstBoundaryF <
          baseline.worstBoundaryF -
            0.01
      ) {
        throw new Error(
          `${candidate.variant} changed ${fixture} quality too much: IoU delta ${meanIouDelta.toFixed(4)}, boundary delta ${meanBoundaryDelta.toFixed(4)}.`,
        );
      }

      return {
        speedup:
          candidate.trackingFps /
          baseline.trackingFps,
        meanIouDelta,
        meanBoundaryDelta,
      };
    };

    cases.push({
      fixture,
      point,
      order,
      baseline,
      decoder: {
        result:
          decoder,
        ...compare(
          decoder,
        ),
      },
      decoderMemory: {
        result:
          decoderMemory,
        ...compare(
          decoderMemory,
        ),
      },
      fusedStep: {
        result:
          fusedStep,
        ...compare(
          fusedStep,
        ),
      },
    });
  }

  const response =
    await fetch(
      "/result",
      {
        method:
          "POST",
        body:
          JSON.stringify({
            schemaVersion: 2,
            cases,
            multiSubject,
          }),
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      await response.text(),
    );
  }
};

void main().catch(
  async (
    error,
  ) => {
    await fetch(
      "/failure",
      {
        method:
          "POST",
        body:
          JSON.stringify({
            message:
              String(
                error,
              ),
            stack:
              error instanceof
              Error
                ? error.stack
                : "",
          }),
      },
    );
  },
);
