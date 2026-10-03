import {
  createVideoSegmentationAdapter,
} from "./adapter";
import {
  createBiRefNetSeeder,
  maskOverlapWithBiRefNet,
  softMaskOverlapWithBiRefNet,
} from "./birefnet-seed";
import {
  VIDEO_SEGMENTATION_CANDIDATES,
} from "./candidates";
import {
  openMediaBunnyVideoSource,
} from "./media-source";
import {
  binaryMaskIou,
  davisBoundaryF,
} from "./quality-metrics";
import {
  QUALITY_FIXTURES,
  QUALITY_FRAME_COUNT,
  QUALITY_FRAME_RATE,
  isQualityFixtureId,
  qualityMaskRoute,
  qualityVideoRoute,
} from "./quality-fixture";

import type {
  QualityFixtureId,
} from "./quality-fixture";

import type {
  VideoSegmentationAdapter,
  VideoSegmentationCandidate,
  VideoSegmentationMask,
} from "./types";

type QualityCandidate =
  | "edgetam"
  | "sam21-primary";

type QualitySeedMode =
  | "model"
  | "oracle"
  | "birefnet"
  | "grid-oracle"
  | "grid-model";

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

type GroundTruthMetrics = {
  readonly iou: number;
  readonly boundaryF: number;
  readonly jAndF: number;
};

type SeedAlternativeQuality = {
  readonly modelIou:
    number | null;
  readonly groundTruthIou:
    number;
  readonly groundTruthBoundaryF:
    number;
  readonly groundTruthJAndF:
    number;
};

type QualityFrame = {
  readonly frameIndex: number;
  readonly timestamp: number;
  readonly inferenceMs: number;
  readonly groundTruthIou: number;
  readonly groundTruthBoundaryF:
    number;
  readonly groundTruthJAndF:
    number;
  readonly modelIou:
    number | null;
  readonly objectScore:
    number | null;
};

type AutomaticSeedQuality = {
  readonly modelRevision: string;
  readonly modelLoadMs: number;
  readonly inferenceMs: number;
  readonly maxLogit: number;
  readonly positiveFraction:
    number;
  readonly usedFallbackPoint:
    boolean;
  readonly selectionMetric:
    "binary-iou" |
    "soft-iou";
  readonly groundTruthIou: number;
  readonly groundTruthBoundaryF:
    number;
  readonly groundTruthJAndF:
    number;
  readonly proposalOverlaps:
    readonly number[];
  readonly selectedProposalOverlap:
    number | null;
};

type GridDiscoveryCandidate = {
  readonly point:
    QualitySeedPoint;
  readonly proposalIndex:
    number;
  readonly modelIou:
    number | null;
  readonly stability: number;
  readonly areaFraction: number;
  readonly bboxAreaFraction:
    number;
  readonly centroid:
    QualitySeedPoint | null;
  readonly touchesFrame:
    boolean;
  readonly edgePixelFraction:
    number;
  readonly fingerprint32:
    string;
  readonly groundTruthIou: number;
  readonly groundTruthBoundaryF:
    number;
  readonly groundTruthJAndF:
    number;
};

type GridDiscoverySelector =
  | "oracle-j-and-f"
  | "proposal0-nonedge-stability-area";

type GridDiscoveryQuality = {
  readonly pointsPerSide: number;
  readonly candidateCount: number;
  readonly selector:
    GridDiscoverySelector;
  readonly selectedCandidate:
    number;
  readonly candidates:
    readonly GridDiscoveryCandidate[];
};

type QualityReport = {
  readonly schemaVersion: 1;
  readonly fixture:
    QualityFixtureId;
  readonly fixtureLabel:
    string;
  readonly candidate:
    QualityCandidate;
  readonly seedMode:
    QualitySeedMode;
  readonly proposalIndex:
    number | null;
  readonly automaticSeed:
    AutomaticSeedQuality | null;
  readonly gridDiscovery:
    GridDiscoveryQuality | null;
  readonly model:
    string;
  readonly frameCount: number;
  readonly loadMs: number;
  readonly seedPoint: {
    readonly x: number;
    readonly y: number;
  };
  readonly seedIou: number;
  readonly seedBoundaryF: number;
  readonly seedAlternatives:
    readonly SeedAlternativeQuality[];
  readonly bestSeedAlternativeIou:
    number;
  readonly bestSeedAlternativeJAndF:
    number;
  readonly meanTrackedIou: number;
  readonly minTrackedIou: number;
  readonly meanTrackedBoundaryF:
    number;
  readonly minTrackedBoundaryF:
    number;
  readonly meanTrackedJAndF:
    number;
  readonly meanTrackedInferenceMs:
    number;
  readonly frames:
    readonly QualityFrame[];
};

type QualityFailure = {
  readonly fixture:
    QualityFixtureId;
  readonly candidate:
    QualityCandidate;
  readonly seedMode:
    QualitySeedMode;
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

const seedModeFromLocation =
  (): QualitySeedMode => {
    const mode =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "seedMode",
      ) ??
      "model";

    switch (
      mode
    ) {
      case "model":
      case "oracle":
      case "birefnet":
      case "grid-oracle":
      case "grid-model":
        return mode;

      default:
        throw new Error(
          `Unknown quality seed mode "${mode}".`,
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

const fixtureFromLocation =
  (): QualityFixtureId => {
    const fixture =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "fixture",
      ) ??
      "";

    if (
      isQualityFixtureId(
        fixture,
      )
    ) {
      return fixture;
    }

    throw new Error(
      `Unknown quality fixture "${fixture}".`,
    );
  };


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

const loadGroundTruth =
  async (
    fixture:
      QualityFixtureId,
    index: number,
  ): Promise<GroundTruth> => {
    const response =
      await fetch(
        qualityMaskRoute(
          fixture,
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

const groundTruthMetrics = (
  prediction:
    VideoSegmentationMask,
  groundTruth:
    GroundTruth,
): GroundTruthMetrics => {
  const rgba =
    rgbaFor(
      groundTruth,
      prediction.width,
      prediction.height,
    );

  const predicted =
    new Uint8Array(
      prediction.logits.length,
    );

  const expected =
    new Uint8Array(
      prediction.logits.length,
    );

  for (
    let pixel = 0;
    pixel <
    prediction.logits.length;
    pixel += 1
  ) {
    predicted[pixel] =
      (prediction.logits[
        pixel
      ] ??
        0) >
      0
        ? 1
        : 0;

    expected[pixel] =
      isForeground(
        rgba,
        pixel,
      )
        ? 1
        : 0;
  }

  const iou =
    binaryMaskIou(
      predicted,
      expected,
    );

  const boundaryF =
    davisBoundaryF(
      predicted,
      expected,
      prediction.width,
      prediction.height,
    );

  return {
    iou,
    boundaryF,
    jAndF:
      (
        iou +
        boundaryF
      ) /
      2,
  };
};

const stabilityScore = (
  mask:
    VideoSegmentationMask,
  offset = 1,
): number => {
  let intersection = 0;

  let union = 0;

  for (
    const logit of
    mask.logits
  ) {
    if (
      logit >
      offset
    ) {
      intersection += 1;
    }

    if (
      logit >
      -offset
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

const maskAreaFraction = (
  mask:
    VideoSegmentationMask,
): number => {
  let foreground = 0;

  for (
    const logit of
    mask.logits
  ) {
    if (
      logit >
      0
    ) {
      foreground += 1;
    }
  }

  return foreground /
    mask.logits.length;
};

type MaskGeometry = {
  readonly bboxAreaFraction:
    number;
  readonly centroid:
    QualitySeedPoint | null;
  readonly touchesFrame:
    boolean;
  readonly edgePixelFraction:
    number;
};

const maskGeometry = (
  mask:
    VideoSegmentationMask,
): MaskGeometry => {
  let foreground = 0;

  let edgePixels = 0;

  let minX =
    mask.width;

  let minY =
    mask.height;

  let maxX = -1;

  let maxY = -1;

  let sumX = 0;

  let sumY = 0;

  for (
    let y = 0;
    y <
    mask.height;
    y += 1
  ) {
    for (
      let x = 0;
      x <
      mask.width;
      x += 1
    ) {
      if (
        (mask.logits[
          y *
            mask.width +
            x
        ] ??
          Number.NEGATIVE_INFINITY) <=
        0
      ) {
        continue;
      }

      foreground += 1;

      sumX += x;

      sumY += y;

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

      if (
        x === 0 ||
        y === 0 ||
        x ===
          mask.width - 1 ||
        y ===
          mask.height - 1
      ) {
        edgePixels += 1;
      }
    }
  }

  if (
    foreground ===
    0
  ) {
    return {
      bboxAreaFraction: 0,
      centroid: null,
      touchesFrame:
        false,
      edgePixelFraction: 0,
    };
  }

  const bboxPixels =
    (
      maxX -
      minX +
      1
    ) *
    (
      maxY -
      minY +
      1
    );

  return {
    bboxAreaFraction:
      bboxPixels /
      (
        mask.width *
        mask.height
      ),
    centroid: {
      x:
        sumX /
        foreground /
        Math.max(
          1,
          mask.width - 1,
        ),
      y:
        sumY /
        foreground /
        Math.max(
          1,
          mask.height - 1,
        ),
    },
    touchesFrame:
      minX === 0 ||
      minY === 0 ||
      maxX ===
        mask.width - 1 ||
      maxY ===
        mask.height - 1,
    edgePixelFraction:
      edgePixels /
      foreground,
  };
};

const maskFingerprint32 = (
  mask:
    VideoSegmentationMask,
): string => {
  const side = 32;

  const bytes =
    new Uint8Array(
      side *
        side /
        8,
    );

  for (
    let y = 0;
    y <
    side;
    y += 1
  ) {
    const sourceY =
      Math.min(
        mask.height - 1,
        Math.floor(
          (
            (y + 0.5) /
            side
          ) *
            mask.height,
        ),
      );

    for (
      let x = 0;
      x <
      side;
      x += 1
    ) {
      const sourceX =
        Math.min(
          mask.width - 1,
          Math.floor(
            (
              (x + 0.5) /
              side
            ) *
              mask.width,
          ),
        );

      if (
        (mask.logits[
          sourceY *
            mask.width +
            sourceX
        ] ??
          Number.NEGATIVE_INFINITY) <=
        0
      ) {
        continue;
      }

      const bit =
        y *
          side +
        x;

      bytes[
        bit >>
          3
      ] |=
        128 >>
        (
          bit &
          7
        );
    }
  }

  let binary = "";

  for (
    const byte of
    bytes
  ) {
    binary +=
      String.fromCharCode(
        byte,
      );
  }

  return btoa(
    binary,
  );
};

const discoveryGrid = (
  pointsPerSide: number,
): readonly QualitySeedPoint[] => {
  const points:
    QualitySeedPoint[] = [];

  for (
    let y = 0;
    y <
    pointsPerSide;
    y += 1
  ) {
    for (
      let x = 0;
      x <
      pointsPerSide;
      x += 1
    ) {
      points.push({
        x:
          (x + 0.5) /
          pointsPerSide,
        y:
          (y + 0.5) /
          pointsPerSide,
      });
    }
  }

  return points;
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

    const fixture =
      fixtureFromLocation();

    const seedMode =
      seedModeFromLocation();

    if (
      (
        seedMode ===
          "oracle" ||
        seedMode ===
          "grid-oracle" ||
        seedMode ===
          "grid-model"
      ) &&
      requested !==
        "edgetam"
    ) {
      throw new Error(
        "Oracle seed modes are only used to diagnose EdgeTAM seed selection.",
      );
    }

    const candidate =
      modelFor(
        requested,
      );

    const videoResponse =
      await fetch(
        qualityVideoRoute(
          fixture,
        ),
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
              fixture,
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

    let seedPoint:
      QualitySeedPoint = {
        x: 0.5,
        y: 0.5,
      };

    if (
      seedMode !==
        "birefnet" &&
      seedMode !==
        "grid-oracle" &&
      seedMode !==
        "grid-model"
    ) {
      seedPoint =
        seedPointFromMask(
          groundTruth[0]!,
        );
    }

    let proposalIndex:
      number | undefined;

    let automaticSeed:
      AutomaticSeedQuality | null =
        null;

    let gridDiscovery:
      GridDiscoveryQuality | null =
        null;

    if (
      seedMode ===
      "birefnet"
    ) {
      const decoded =
        await source.frameAt(
          source.info.firstTimestamp,
        );

      if (
        decoded ===
        null
      ) {
        throw new Error(
          "MediaBunny could not decode the DAVIS BiRefNet seed frame.",
        );
      }

      const modelLoadStartedAt =
        performance.now();

      const seeder =
        await createBiRefNetSeeder();

      const modelLoadMs =
        performance.now() -
        modelLoadStartedAt;

      let probe:
        VideoSegmentationAdapter |
        undefined;

      try {
        const inferenceStartedAt =
          performance.now();

        const seed =
          await seeder.seed(
            decoded.frame,
          );

        const inferenceMs =
          performance.now() -
          inferenceStartedAt;

        seedPoint =
          seed.point;

        const matte:
          VideoSegmentationMask = {
            logits:
              seed.logits,
            width:
              seed.width,
            height:
              seed.height,
          };

        const quality =
          groundTruthMetrics(
            matte,
            groundTruth[0]!,
          );

        let proposalOverlaps:
          number[] = [];

        let selectedProposalOverlap:
          number | null =
            null;

        if (
          requested ===
          "edgetam"
        ) {
          probe =
            await createVideoSegmentationAdapter(
              candidate,
            );

          const preview =
            await probe.seed(
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
            );

          const proposals =
            preview.alternatives ??
            [preview];

          const useSoftOverlap =
            seed.positiveFraction ===
            0;

          proposalOverlaps =
            proposals.map(
              (proposal) =>
                useSoftOverlap
                  ? softMaskOverlapWithBiRefNet(
                      seed,
                      proposal,
                    )
                  : maskOverlapWithBiRefNet(
                      seed,
                      proposal,
                    ),
            );

          let bestIndex = 0;

          for (
            let index = 1;
            index <
            proposalOverlaps.length;
            index += 1
          ) {
            if (
              (proposalOverlaps[index] ??
                Number.NEGATIVE_INFINITY) >
              (proposalOverlaps[bestIndex] ??
                Number.NEGATIVE_INFINITY)
            ) {
              bestIndex =
                index;
            }
          }

          proposalIndex =
            bestIndex;

          selectedProposalOverlap =
            proposalOverlaps[
              bestIndex
            ] ??
            null;
        }

        automaticSeed = {
          modelRevision:
            seed.modelRevision,
          modelLoadMs,
          inferenceMs,
          maxLogit:
            seed.maxLogit,
          positiveFraction:
            seed.positiveFraction,
          usedFallbackPoint:
            seed.usedFallbackPoint,
          selectionMetric:
            seed.positiveFraction ===
              0
              ? "soft-iou"
              : "binary-iou",
          groundTruthIou:
            quality.iou,
          groundTruthBoundaryF:
            quality.boundaryF,
          groundTruthJAndF:
            quality.jAndF,
          proposalOverlaps,
          selectedProposalOverlap,
        };
      } finally {
        decoded.close();

        if (
          probe !==
          undefined
        ) {
          await probe.close();
        }

        await seeder.close();
      }
    }

    if (
      seedMode ===
        "grid-oracle" ||
      seedMode ===
        "grid-model"
    ) {
      const decoded =
        await source.frameAt(
          source.info.firstTimestamp,
        );

      if (
        decoded ===
        null
      ) {
        throw new Error(
          "MediaBunny could not decode the DAVIS grid-discovery seed frame.",
        );
      }

      const probe =
        await createVideoSegmentationAdapter(
          candidate,
        );

      try {
        if (
          probe.discover ===
          undefined
        ) {
          throw new Error(
            "The selected video adapter does not expose automatic seed discovery.",
          );
        }

        const pointsPerSide = 7;

        const points =
          discoveryGrid(
            pointsPerSide,
          );

        const discoveries =
          await probe.discover(
            decoded.frame,
            points.map(
              (point) => ({
                ...point,
                label: 1 as const,
              }),
            ),
          );

        const candidates =
          discoveries.map(
            (discovery) => {
              const quality =
                groundTruthMetrics(
                  discovery.mask,
                  groundTruth[0]!,
                );

              const geometry =
                maskGeometry(
                  discovery.mask,
                );

              return {
                point: {
                  x:
                    discovery.point.x,
                  y:
                    discovery.point.y,
                },
                proposalIndex:
                  discovery.proposalIndex,
                modelIou:
                  discovery.mask.iou ??
                  null,
                stability:
                  stabilityScore(
                    discovery.mask,
                  ),
                areaFraction:
                  maskAreaFraction(
                    discovery.mask,
                  ),
                bboxAreaFraction:
                  geometry.bboxAreaFraction,
                centroid:
                  geometry.centroid,
                touchesFrame:
                  geometry.touchesFrame,
                edgePixelFraction:
                  geometry.edgePixelFraction,
                fingerprint32:
                  maskFingerprint32(
                    discovery.mask,
                  ),
                groundTruthIou:
                  quality.iou,
                groundTruthBoundaryF:
                  quality.boundaryF,
                groundTruthJAndF:
                  quality.jAndF,
              };
            },
          );

        if (
          candidates.length ===
          0
        ) {
          throw new Error(
            "EdgeTAM grid discovery returned no seed candidates.",
          );
        }

        let best = 0;

        let selector:
          GridDiscoverySelector;

        if (
          seedMode ===
          "grid-model"
        ) {
          selector =
            "proposal0-nonedge-stability-area";

          const eligible =
            candidates
              .map(
                (
                  candidate,
                  index,
                ) => ({
                  candidate,
                  index,
                }),
              )
              .filter(
                ({ candidate }) =>
                  candidate
                    .proposalIndex ===
                    0 &&
                  !candidate
                    .touchesFrame,
              );

          if (
            eligible.length ===
            0
          ) {
            throw new Error(
              "EdgeTAM grid discovery found no non-edge proposal-0 subject candidate.",
            );
          }

          best =
            eligible.reduce(
              (
                selected,
                current,
              ) =>
                current.candidate
                  .stability *
                  Math.sqrt(
                    current.candidate
                      .areaFraction,
                  ) >
                selected.candidate
                  .stability *
                  Math.sqrt(
                    selected.candidate
                      .areaFraction,
                  )
                  ? current
                  : selected,
            ).index;
        } else {
          selector =
            "oracle-j-and-f";

          for (
            let index = 1;
            index <
            candidates.length;
            index += 1
          ) {
            if (
              (candidates[index]
                ?.groundTruthJAndF ??
                Number.NEGATIVE_INFINITY) >
              (candidates[best]
                ?.groundTruthJAndF ??
                Number.NEGATIVE_INFINITY)
            ) {
              best =
                index;
            }
          }
        }

        const selected =
          candidates[best]!;

        seedPoint =
          selected.point;

        proposalIndex =
          selected.proposalIndex;

        gridDiscovery = {
          pointsPerSide,
          candidateCount:
            candidates.length,
          selector,
          selectedCandidate:
            best,
          candidates,
        };
      } finally {
        decoded.close();

        await probe.close();
      }
    }

    if (
      seedMode ===
      "oracle"
    ) {
      const decoded =
        await source.frameAt(
          source.info.firstTimestamp,
        );

      if (
        decoded ===
        null
      ) {
        throw new Error(
          "MediaBunny could not decode the DAVIS oracle seed frame.",
        );
      }

      const probe =
        await createVideoSegmentationAdapter(
          candidate,
        );

      try {
        const preview =
          await probe.seed(
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
          );

        const proposals =
          preview.alternatives ??
          [preview];

        let bestIndex = 0;

        let bestQuality =
          Number.NEGATIVE_INFINITY;

        proposals.forEach(
          (
            proposal,
            index,
          ) => {
            const quality =
              groundTruthMetrics(
                proposal,
                groundTruth[0]!,
              ).jAndF;

            if (
              quality >
              bestQuality
            ) {
              bestQuality =
                quality;

              bestIndex =
                index;
            }
          },
        );

        proposalIndex =
          bestIndex;
      } finally {
        decoded.close();

        await probe.close();
      }
    }

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

    let seedAlternatives:
      SeedAlternativeQuality[] = [];

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
                    proposalIndex,
                  },
                  0,
                  QUALITY_FRAME_COUNT,
                )
              : await adapter.track(
                  decoded.frame,
                  frameIndex,
                  QUALITY_FRAME_COUNT,
                );

          const quality =
            groundTruthMetrics(
              prediction,
              groundTruth[
                frameIndex
              ]!,
            );

          if (
            frameIndex ===
              0 &&
            prediction.alternatives !==
              undefined
          ) {
            seedAlternatives =
              prediction.alternatives.map(
                (
                  alternative,
                ) => {
                  const alternativeQuality =
                    groundTruthMetrics(
                      alternative,
                      groundTruth[0]!,
                    );

                  return {
                    modelIou:
                      alternative.iou ??
                      null,
                    groundTruthIou:
                      alternativeQuality.iou,
                    groundTruthBoundaryF:
                      alternativeQuality.boundaryF,
                    groundTruthJAndF:
                      alternativeQuality.jAndF,
                  };
                },
              );
          }

          frames.push({
            frameIndex,
            timestamp:
              decoded.timestamp,
            inferenceMs:
              performance.now() -
              startedAt,
            groundTruthIou:
              quality.iou,
            groundTruthBoundaryF:
              quality.boundaryF,
            groundTruthJAndF:
              quality.jAndF,
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
        fixture,
        fixtureLabel:
          QUALITY_FIXTURES[
            fixture
          ].label,
        candidate:
          requested,
        seedMode,
        proposalIndex:
          proposalIndex ??
          null,
        automaticSeed,
        gridDiscovery,
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
        seedBoundaryF:
          frames[0]
            ?.groundTruthBoundaryF ??
          0,
        seedAlternatives,
        bestSeedAlternativeIou:
          Math.max(
            frames[0]
              ?.groundTruthIou ??
              0,
            ...seedAlternatives.map(
              (alternative) =>
                alternative.groundTruthIou,
            ),
          ),
        bestSeedAlternativeJAndF:
          Math.max(
            frames[0]
              ?.groundTruthJAndF ??
              0,
            ...seedAlternatives.map(
              (alternative) =>
                alternative.groundTruthJAndF,
            ),
          ),
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
        meanTrackedBoundaryF:
          mean(
            tracked.map(
              (frame) =>
                frame.groundTruthBoundaryF,
            ),
          ),
        minTrackedBoundaryF:
          Math.min(
            ...tracked.map(
              (frame) =>
                frame.groundTruthBoundaryF,
            ),
          ),
        meanTrackedJAndF:
          mean(
            tracked.map(
              (frame) =>
                frame.groundTruthJAndF,
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
      ) ||
      !Number.isFinite(
        report.meanTrackedBoundaryF,
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
      `${report.fixtureLabel} ${report.seedMode} seed quality passed: tracked mean IoU ${report.meanTrackedIou.toFixed(
        4,
      )}, boundary F ${report.meanTrackedBoundaryF.toFixed(
        4,
      )}, J&F ${report.meanTrackedJAndF.toFixed(
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

    const fixture =
      (() => {
        try {
          return fixtureFromLocation();
        } catch {
          return "blackswan" as const;
        }
      })();

    const seedMode =
      (() => {
        try {
          return seedModeFromLocation();
        } catch {
          return "model" as const;
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
        fixture,
        candidate:
          requested,
        seedMode,
        message:
          parsed.message,
        stack:
          parsed.stack ??
          "",
      },
    );
  },
);
