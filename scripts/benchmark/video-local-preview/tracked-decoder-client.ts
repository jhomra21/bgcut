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
  specialized:
    boolean,
) => {
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
      specialized
        ? {
            trackedMaskDecoderUrl:
              SPECIALIZED_DECODER,
          }
        : undefined,
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
      specialized,
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

const main = async () => {
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

    const normal =
      await runTracker(
        fixture,
        file,
        truths,
        point,
        false,
      );

    const specialized =
      await runTracker(
        fixture,
        file,
        truths,
        point,
        true,
      );

    const meanIouDelta =
      specialized.meanIou -
      normal.meanIou;

    const meanBoundaryDelta =
      specialized.meanBoundaryF -
      normal.meanBoundaryF;

    if (
      Math.abs(
        meanIouDelta,
      ) >
        0.005 ||
      Math.abs(
        meanBoundaryDelta,
      ) >
        0.005 ||
      specialized.worstIou <
        normal.worstIou -
          0.01 ||
      specialized.worstBoundaryF <
        normal.worstBoundaryF -
          0.01
    ) {
      throw new Error(
        `Specialized tracked decoder changed ${fixture} quality too much: IoU delta ${meanIouDelta.toFixed(4)}, boundary delta ${meanBoundaryDelta.toFixed(4)}.`,
      );
    }

    cases.push({
      fixture,
      point,
      normal,
      specialized,
      speedup:
        specialized.trackingFps /
        normal.trackingFps,
      meanIouDelta,
      meanBoundaryDelta,
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
            schemaVersion: 1,
            cases,
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
