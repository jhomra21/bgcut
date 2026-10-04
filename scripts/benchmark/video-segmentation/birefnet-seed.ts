import * as ort from "onnxruntime-web/webgpu";

import {
  MODEL_INPUT_SIZE,
  MODEL_PUBLIC_PATH,
  MODEL_REVISION,
  WEBGPU_MODEL_PUBLIC_PATH,
  WEBGPU_MODEL_REVISION,
} from "../../../src/shared/model-config";

import {
  configureVideoOrt,
  floatData,
  frameToNchw,
} from "./runtime-common";

import type {
  VideoSegmentationMask,
} from "./types";

const IMAGENET_MEAN = [
  0.485,
  0.456,
  0.406,
] as const;

const IMAGENET_STD = [
  0.229,
  0.224,
  0.225,
] as const;

const PIXEL_COUNT =
  MODEL_INPUT_SIZE *
  MODEL_INPUT_SIZE;

export type BiRefNetSeedPoint = {
  readonly x: number;
  readonly y: number;
};

export type BiRefNetSeed = {
  readonly logits:
    Float32Array;
  readonly width: number;
  readonly height: number;
  readonly point:
    BiRefNetSeedPoint;
  readonly maxLogit: number;
  readonly positiveFraction:
    number;
  readonly usedFallbackPoint:
    boolean;
  readonly modelRevision:
    string;
};

export type BiRefNetSeedPrecision =
  | "fp32"
  | "fp16";

export type BiRefNetSeeder = {
  seed(
    frame: VideoFrame,
  ): Promise<BiRefNetSeed>;
  close(): Promise<void>;
};

type BiRefNetPointAnalysis = {
  readonly point:
    BiRefNetSeedPoint;
  readonly maxLogit: number;
  readonly positiveFraction:
    number;
  readonly usedFallbackPoint:
    boolean;
};

const analyzeLogits = (
  logits:
    Float32Array,
): BiRefNetPointAnalysis => {
  let minX =
    MODEL_INPUT_SIZE;

  let minY =
    MODEL_INPUT_SIZE;

  let maxX = -1;

  let maxY = -1;

  let positivePixels = 0;

  let maxLogit =
    Number.NEGATIVE_INFINITY;

  let maxLogitX = 0;

  let maxLogitY = 0;

  for (
    let pixel = 0;
    pixel <
    logits.length;
    pixel += 1
  ) {
    const logit =
      logits[pixel] ??
      Number.NEGATIVE_INFINITY;

    const x =
      pixel %
      MODEL_INPUT_SIZE;

    const y =
      Math.floor(
        pixel /
          MODEL_INPUT_SIZE,
      );

    if (
      logit >
      maxLogit
    ) {
      maxLogit =
        logit;

      maxLogitX = x;

      maxLogitY = y;
    }

    if (
      logit <=
      0
    ) {
      continue;
    }

    positivePixels +=
      1;

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

  if (
    !Number.isFinite(
      maxLogit,
    )
  ) {
    throw new Error(
      "BiRefNet returned no finite seed logits.",
    );
  }

  if (
    positivePixels ===
    0
  ) {
    return {
      point: {
        x:
          maxLogitX /
          Math.max(
            1,
            MODEL_INPUT_SIZE -
              1,
          ),
        y:
          maxLogitY /
          Math.max(
            1,
            MODEL_INPUT_SIZE -
              1,
          ),
      },
      maxLogit,
      positiveFraction: 0,
      usedFallbackPoint:
        true,
    };
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
        (logits[
          y *
            MODEL_INPUT_SIZE +
            x
        ] ??
          Number.NEGATIVE_INFINITY) <=
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
    point: {
      x:
        bestX /
        Math.max(
          1,
          MODEL_INPUT_SIZE -
            1,
        ),
      y:
        bestY /
        Math.max(
          1,
          MODEL_INPUT_SIZE -
            1,
        ),
    },
    maxLogit,
    positiveFraction:
      positivePixels /
      logits.length,
    usedFallbackPoint:
      false,
  };
};

export const maskOverlapWithBiRefNet =
  (
    seed:
      BiRefNetSeed,
    mask:
      VideoSegmentationMask,
  ): number => {
    if (
      seed.width < 1 ||
      seed.height < 1 ||
      mask.width < 1 ||
      mask.height < 1
    ) {
      return 0;
    }

    let intersection = 0;

    let union = 0;

    for (
      let y = 0;
      y <
      mask.height;
      y += 1
    ) {
      const seedY =
        Math.min(
          seed.height - 1,
          Math.floor(
            (
              (y + 0.5) /
              mask.height
            ) *
              seed.height,
          ),
        );

      for (
        let x = 0;
        x <
        mask.width;
        x += 1
      ) {
        const seedX =
          Math.min(
            seed.width - 1,
            Math.floor(
              (
                (x + 0.5) /
                mask.width
              ) *
                seed.width,
            ),
          );

        const seedForeground =
          (seed.logits[
            seedY *
              seed.width +
              seedX
          ] ??
            Number.NEGATIVE_INFINITY) >
          0;

        const maskForeground =
          (mask.logits[
            y *
              mask.width +
              x
          ] ??
            Number.NEGATIVE_INFINITY) >
          0;

        if (
          seedForeground &&
          maskForeground
        ) {
          intersection +=
            1;
        }

        if (
          seedForeground ||
          maskForeground
        ) {
          union +=
            1;
        }
      }
    }

    return union ===
      0
      ? 1
      : intersection /
          union;
  };

export const softMaskOverlapWithBiRefNet =
  (
    seed:
      BiRefNetSeed,
    mask:
      VideoSegmentationMask,
  ): number => {
    let intersection = 0;

    let union = 0;

    for (
      let y = 0;
      y <
      mask.height;
      y += 1
    ) {
      const seedY =
        Math.min(
          seed.height - 1,
          Math.floor(
            (
              (y + 0.5) /
              mask.height
            ) *
              seed.height,
          ),
        );

      for (
        let x = 0;
        x <
        mask.width;
        x += 1
      ) {
        const seedX =
          Math.min(
            seed.width - 1,
            Math.floor(
              (
                (x + 0.5) /
                mask.width
              ) *
                seed.width,
            ),
          );

        const probability =
          1 /
          (
            1 +
            Math.exp(
              -(
                seed.logits[
                  seedY *
                    seed.width +
                    seedX
                ] ??
                Number.NEGATIVE_INFINITY
              ),
            )
          );

        const foreground =
          (mask.logits[
            y *
              mask.width +
              x
          ] ??
            Number.NEGATIVE_INFINITY) >
          0
            ? 1
            : 0;

        intersection +=
          probability *
          foreground;

        union +=
          probability +
          foreground -
          probability *
            foreground;
      }
    }

    return union ===
      0
      ? 1
      : intersection /
          union;
  };

export const createBiRefNetSeeder =
  async (
    precision:
      BiRefNetSeedPrecision =
        "fp32",
  ): Promise<BiRefNetSeeder> => {
    configureVideoOrt();

    const modelPath =
      precision ===
      "fp16"
        ? WEBGPU_MODEL_PUBLIC_PATH
        : MODEL_PUBLIC_PATH;

    const modelRevision =
      precision ===
      "fp16"
        ? WEBGPU_MODEL_REVISION
        : MODEL_REVISION;

    const response =
      await fetch(
        modelPath,
        {
          cache:
            "force-cache",
        },
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Could not fetch the bgcut BiRefNet seed model: HTTP ${response.status}.`,
      );
    }

    const session =
      await ort.InferenceSession.create(
        new Uint8Array(
          await response.arrayBuffer(),
        ),
        {
          executionProviders: [
            {
              name:
                "webgpu",
            },
          ],
          graphOptimizationLevel:
            "all",
        },
      );

    const inputName =
      session.inputNames.at(
        0,
      );

    const outputName =
      session.outputNames.at(
        0,
      );

    if (
      inputName ===
        undefined ||
      outputName ===
        undefined
    ) {
      await session.release();

      throw new Error(
        "BiRefNet does not expose the expected seed input and output tensors.",
      );
    }

    return {
      async seed(
        frame,
      ) {
        const input =
          new ort.Tensor(
            "float32",
            frameToNchw(
              frame,
              MODEL_INPUT_SIZE,
              IMAGENET_MEAN,
              IMAGENET_STD,
            ),
            [
              1,
              3,
              MODEL_INPUT_SIZE,
              MODEL_INPUT_SIZE,
            ],
          );

        let outputs:
          Record<
            string,
            ort.Tensor
          > |
          undefined;

        try {
          outputs =
            await session.run({
              [inputName]:
                input,
            });

          const output =
            outputs[
              outputName
            ];

          if (
            output ===
            undefined
          ) {
            throw new Error(
              "BiRefNet completed without returning a seed matte.",
            );
          }

          const logits =
            floatData(
              output,
              "BiRefNet seed matte",
            ).slice();

          if (
            logits.length !==
            PIXEL_COUNT
          ) {
            throw new Error(
              `BiRefNet seed matte had ${logits.length} values; expected ${PIXEL_COUNT}.`,
            );
          }

          const analysis =
            analyzeLogits(
              logits,
            );

          return {
            logits,
            width:
              MODEL_INPUT_SIZE,
            height:
              MODEL_INPUT_SIZE,
            point:
              analysis.point,
            maxLogit:
              analysis.maxLogit,
            positiveFraction:
              analysis.positiveFraction,
            usedFallbackPoint:
              analysis.usedFallbackPoint,
            modelRevision,
          };
        } finally {
          input.dispose();

          if (
            outputs !==
            undefined
          ) {
            for (
              const tensor of
              Object.values(
                outputs,
              )
            ) {
              tensor.dispose();
            }
          }
        }
      },

      async close() {
        await session.release();
      },
    };
  };
