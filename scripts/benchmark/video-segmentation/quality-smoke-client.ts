import {
  createVideoSegmentationAdapter,
} from "./adapter";
import {
  VIDEO_SEGMENTATION_CANDIDATES,
} from "./candidates";
import {
  openMediaBunnyVideoSource,
} from "./media-source";
import {
  QUALITY_FRAME_COUNT,
  QUALITY_FRAME_RATE,
} from "./quality-fixture";

import type {
  VideoSegmentationCandidate,
  VideoSegmentationMask,
} from "./types";

type QualityCandidate =
  | "edgetam"
  | "sam21-primary";

type GroundTruth = {
  readonly bitmap:
    ImageBitmap;
  readonly width: number;
  readonly height: number;
};

type QualitySeedPoint = {
  readonly x: number;
  readonly y: number;
};

type QualityFrame = {
  readonly frameIndex: number;
  readonly timestamp: number;
  readonly inferenceMs: number;
  readonly groundTruthIou: number;
  readonly modelIou:
    number | null;
  readonly objectScore:
    number | null;
};

type QualityReport = {
  readonly schemaVersion: 1;
  readonly fixture:
    "DAVIS blackswan";
  readonly candidate:
    QualityCandidate;
  readonly model:
    string;
  readonly frameCount: number;
  readonly loadMs: number;
  readonly seedPoint: {
    readonly x: number;
    readonly y: number;
  };
  readonly seedIou: number;
  readonly meanTrackedIou: number;
  readonly minTrackedIou: number;
  readonly meanTrackedInferenceMs:
    number;
  readonly frames:
    readonly QualityFrame[];
};

type QualityFailure = {
  readonly candidate:
    QualityCandidate;
  readonly message: string;
  readonly stack: string;
};

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (
  status ===
  null
) {
  throw new Error(
    "Video quality smoke status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
};

const candidateFromLocation =
  (): QualityCandidate => {
    const candidate =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "candidate",
      );

    switch (
      candidate
    ) {
      case "edgetam":
      case "sam21-primary":
        return candidate;

      default:
        throw new Error(
          `Unknown quality candidate "${candidate}".`,
        );
    }
  };

const modelFor = (
  candidate:
    QualityCandidate,
): VideoSegmentationCandidate =>
  candidate ===
  "edgetam"
    ? VIDEO_SEGMENTATION_CANDIDATES
        .edgetam
    : VIDEO_SEGMENTATION_CANDIDATES[
        "sam21-tiny"
      ];

const mean = (
  values:
    readonly number[],
): number =>
  values.length ===
  0
    ? 0
    : values.reduce(
        (
          sum,
          value,
        ) =>
          sum +
          value,
        0,
      ) /
      values.length;

const maskUrl = (
  index: number,
): string =>
  `/quality/blackswan/${index
    .toString()
    .padStart(
      5,
      "0",
    )}.png`;

const loadGroundTruth =
  async (
    index: number,
  ): Promise<GroundTruth> => {
    const response =
      await fetch(
        maskUrl(
          index,
        ),
        {
          cache:
            "force-cache",
        },
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Could not load DAVIS mask ${index}: HTTP ${response.status}.`,
      );
    }

    const bitmap =
      await createImageBitmap(
        await response.blob(),
      );

    return {
      bitmap,
      width:
        bitmap.width,
      height:
        bitmap.height,
    };
  };

const rgbaFor = (
  groundTruth:
    GroundTruth,
  width: number,
  height: number,
): Uint8ClampedArray => {
  const canvas =
    new OffscreenCanvas(
      width,
      height,
    );

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
      "Could not create DAVIS mask canvas.",
    );
  }

  context.imageSmoothingEnabled =
    false;

  context.drawImage(
    groundTruth.bitmap,
    0,
    0,
    width,
    height,
  );

  return context.getImageData(
    0,
    0,
    width,
    height,
  ).data;
};

const isForeground = (
  rgba:
    Uint8ClampedArray,
  pixel: number,
): boolean => {
  const offset =
    pixel * 4;

  return (
    (rgba[offset] ??
      0) !==
      0 ||
    (rgba[
      offset + 1
    ] ??
      0) !==
      0 ||
    (rgba[
      offset + 2
    ] ??
      0) !==
      0
  );
};

const seedPointFromMask = (
  groundTruth:
    GroundTruth,
): QualitySeedPoint => {
  const rgba =
    rgbaFor(
      groundTruth,
      groundTruth.width,
      groundTruth.height,
    );

  let minX =
    groundTruth.width;

  let minY =
    groundTruth.height;

  let maxX = -1;

  let maxY = -1;

  for (
    let y = 0;
    y <
    groundTruth.height;
    y += 1
  ) {
    for (
      let x = 0;
      x <
      groundTruth.width;
      x += 1
    ) {
      if (
        !isForeground(
          rgba,
          y *
            groundTruth.width +
            x,
        )
      ) {
        continue;
      }

      minX =
        Math.min(
          minX,
          x,
        );

      minY =
        Math.min(
          minY,
          y,
        );

      maxX =
        Math.max(
          maxX,
          x,
        );

      maxY =
        Math.max(
          maxY,
          y,
        );
    }
  }

  if (
    maxX < minX ||
    maxY < minY
  ) {
    throw new Error(
      "DAVIS seed mask has no foreground.",
    );
  }

  const centerX =
    (minX +
      maxX) /
    2;

  const centerY =
    (minY +
      maxY) /
    2;

  let bestX =
    minX;

  let bestY =
    minY;

  let bestDistance =
    Number.POSITIVE_INFINITY;

  for (
    let y = minY;
    y <= maxY;
    y += 1
  ) {
    for (
      let x = minX;
      x <= maxX;
      x += 1
    ) {
      if (
        !isForeground(
          rgba,
          y *
            groundTruth.width +
            x,
        )
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
        bestDistance
      ) {
        bestDistance =
          distance;

        bestX = x;

        bestY = y;
      }
    }
  }

  return {
    x:
      bestX /
      Math.max(
        1,
        groundTruth.width -
          1,
      ),
    y:
      bestY /
      Math.max(
        1,
        groundTruth.height -
          1,
      ),
  };
};

const groundTruthIou = (
  prediction:
    VideoSegmentationMask,
  groundTruth:
    GroundTruth,
): number => {
  const rgba =
    rgbaFor(
      groundTruth,
      prediction.width,
      prediction.height,
    );

  let intersection = 0;

  let union = 0;

  for (
    let pixel = 0;
    pixel <
    prediction.logits.length;
    pixel += 1
  ) {
    const predicted =
      (prediction.logits[
        pixel
      ] ??
        0) >
      0;

    const expected =
      isForeground(
        rgba,
        pixel,
      );

    if (
      predicted &&
      expected
    ) {
      intersection += 1;
    }

    if (
      predicted ||
      expected
    ) {
      union += 1;
    }
  }

  return union ===
    0
    ? 1
    : intersection /
      union;
};

const postJson = async (
  path: string,
  value:
    | QualityReport
    | QualityFailure,
): Promise<void> => {
  const response =
    await fetch(
      path,
      {
        method:
          "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify(
            value,
          ),
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

const main =
  async (): Promise<void> => {
    const requested =
      candidateFromLocation();

    const candidate =
      modelFor(
        requested,
      );

    const videoResponse =
      await fetch(
        "/quality/blackswan.mp4",
        {
          cache:
            "force-cache",
        },
      );

    if (
      !videoResponse.ok
    ) {
      throw new Error(
        `Could not load DAVIS quality video: HTTP ${videoResponse.status}.`,
      );
    }

    const source =
      await openMediaBunnyVideoSource(
        await videoResponse.blob(),
      );

    const groundTruth =
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
            loadGroundTruth(
              index,
            ),
        ),
      );

    for (
      const mask of
      groundTruth
    ) {
      if (
        mask.width !==
          source.info.width ||
        mask.height !==
          source.info.height
      ) {
        throw new Error(
          `DAVIS mask geometry ${mask.width}x${mask.height} does not match video geometry ${source.info.width}x${source.info.height}.`,
        );
      }
    }

    const seedPoint =
      seedPointFromMask(
        groundTruth[0]!,
      );

    const loadStartedAt =
      performance.now();

    const adapter =
      await createVideoSegmentationAdapter(
        candidate,
      );

    const loadMs =
      performance.now() -
      loadStartedAt;

    const frames:
      QualityFrame[] = [];

    try {
      for (
        let frameIndex = 0;
        frameIndex <
        QUALITY_FRAME_COUNT;
        frameIndex += 1
      ) {
        const timestamp =
          source.info.firstTimestamp +
          frameIndex /
            QUALITY_FRAME_RATE;

        const decoded =
          await source.frameAt(
            timestamp,
          );

        if (
          decoded ===
          null
        ) {
          throw new Error(
            `MediaBunny could not decode DAVIS frame ${frameIndex}.`,
          );
        }

        try {
          const tolerance =
            1 /
              QUALITY_FRAME_RATE /
              2 +
            1e-3;

          if (
            Math.abs(
              decoded.timestamp -
                timestamp,
            ) >
            tolerance
          ) {
            throw new Error(
              `DAVIS frame ${frameIndex} decoded at ${decoded.timestamp} instead of ${timestamp}.`,
            );
          }

          const startedAt =
            performance.now();

          const prediction =
            frameIndex ===
            0
              ? await adapter.seed(
                  decoded.frame,
                  {
                    points: [
                      {
                        x:
                          seedPoint.x,
                        y:
                          seedPoint.y,
                        label: 1,
                      },
                    ],
                  },
                  0,
                  QUALITY_FRAME_COUNT,
                )
              : await adapter.track(
                  decoded.frame,
                  frameIndex,
                  QUALITY_FRAME_COUNT,
                );

          frames.push({
            frameIndex,
            timestamp:
              decoded.timestamp,
            inferenceMs:
              performance.now() -
              startedAt,
            groundTruthIou:
              groundTruthIou(
                prediction,
                groundTruth[
                  frameIndex
                ]!,
              ),
            modelIou:
              prediction.iou ??
              null,
            objectScore:
              prediction.objectScore ??
              null,
          });
        } finally {
          decoded.close();
        }
      }
    } finally {
      await adapter.close();

      source.close();

      for (
        const mask of
        groundTruth
      ) {
        mask.bitmap.close();
      }
    }

    const tracked =
      frames.slice(
        1,
      );

    const report:
      QualityReport = {
        schemaVersion: 1,
        fixture:
          "DAVIS blackswan",
        candidate:
          requested,
        model:
          candidate.repository,
        frameCount:
          frames.length,
        loadMs,
        seedPoint,
        seedIou:
          frames[0]
            ?.groundTruthIou ??
          0,
        meanTrackedIou:
          mean(
            tracked.map(
              (frame) =>
                frame.groundTruthIou,
            ),
          ),
        minTrackedIou:
          Math.min(
            ...tracked.map(
              (frame) =>
                frame.groundTruthIou,
            ),
          ),
        meanTrackedInferenceMs:
          mean(
            tracked.map(
              (frame) =>
                frame.inferenceMs,
            ),
          ),
        frames,
      };

    if (
      report.frameCount !==
        QUALITY_FRAME_COUNT ||
      !Number.isFinite(
        report.meanTrackedIou,
      )
    ) {
      throw new Error(
        "DAVIS quality report is incomplete.",
      );
    }

    await postJson(
      "/result",
      report,
    );

    writeStatus(
      `DAVIS quality passed: seed IoU ${report.seedIou.toFixed(
        4,
      )}, tracked mean IoU ${report.meanTrackedIou.toFixed(
        4,
      )}.`,
    );
  };

void main().catch(
  (error) => {
    const requested =
      (() => {
        try {
          return candidateFromLocation();
        } catch {
          return "edgetam" as const;
        }
      })();

    const parsed =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    writeStatus(
      "VIDEO QUALITY SMOKE FAILED",
    );

    writeStatus(
      parsed.message,
    );

    void postJson(
      "/failure",
      {
        candidate:
          requested,
        message:
          parsed.message,
        stack:
          parsed.stack ??
          "",
      },
    );
  },
);
