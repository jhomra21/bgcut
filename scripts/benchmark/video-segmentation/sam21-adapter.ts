import * as ort from "onnxruntime-web/webgpu";

import {
  channelsToTokens,
  closeVideoSessions,
  concatenateFloat32,
  configureVideoOrt,
  createVideoSession,
  fetchVideoModelConstants,
  floatData,
  frameToNchw,
  pointPromptTensors,
  temporalPositions,
} from "./runtime-common";

import type {
  VideoSegmentationAdapter,
  VideoSegmentationCandidate,
  VideoSegmentationMask,
  VideoSegmentationPrompt,
} from "./types";

const FEATURE_CHANNELS = 256;

const MEMORY_DIMENSION = 64;

const MEMORY_FRAMES = 7;

const MAX_POINTERS = 16;

const POINTER_DIMENSION = 256;

const POINTER_TOKENS =
  POINTER_DIMENSION /
  MEMORY_DIMENSION;

const RELIABLE_IOU = 0.25;

type SamSessions = {
  readonly visionEncoder:
    ort.InferenceSession;
  readonly maskDecoder:
    ort.InferenceSession;
  readonly memoryAttention:
    ort.InferenceSession;
  readonly memoryEncoder:
    ort.InferenceSession;
  readonly pointerTpos:
    ort.InferenceSession;
};

type SamVision = {
  readonly feats0: ort.Tensor;
  readonly feats1: ort.Tensor;
  readonly feats2: ort.Tensor;
  readonly feats2NoMemory:
    ort.Tensor;
  readonly position:
    ort.Tensor;
};

type SamDecoded = {
  readonly mask:
    VideoSegmentationMask;
  readonly highResolution:
    Float32Array;
  readonly pointer:
    Float32Array;
  readonly objectScore: number;
};

type StoredMemory = {
  readonly index: number;
  readonly tokens:
    Float32Array;
  readonly positions:
    Float32Array;
  readonly pointer:
    Float32Array;
};

type SamMemoryAssembly = {
  readonly memory:
    Float32Array;
  readonly memoryPositions:
    Float32Array;
  readonly normalizedPointerDiffs:
    Float32Array;
};

const requireTensor = (
  outputs:
    Record<
      string,
      ort.Tensor
    >,
  name: string,
): ort.Tensor => {
  const tensor =
    outputs[name];

  if (tensor === undefined) {
    throw new Error(
      `SAM 2.1 output "${name}" is missing.`,
    );
  }

  return tensor;
};

const decodedMask = (
  outputs:
    Record<
      string,
      ort.Tensor
    >,
): SamDecoded => {
  const logits =
    floatData(
      requireTensor(
        outputs,
        "low_res_mask",
      ),
      "SAM 2.1 low_res_mask",
    ).slice();

  const highResolution =
    floatData(
      requireTensor(
        outputs,
        "high_res_mask",
      ),
      "SAM 2.1 high_res_mask",
    ).slice();

  const iou =
    floatData(
      requireTensor(
        outputs,
        "iou",
      ),
      "SAM 2.1 iou",
    )[0] ??
    0;

  const objectScore =
    floatData(
      requireTensor(
        outputs,
        "object_score_logits",
      ),
      "SAM 2.1 object_score_logits",
    )[0] ??
    0;

  const pointer =
    floatData(
      requireTensor(
        outputs,
        "object_pointer",
      ),
      "SAM 2.1 object_pointer",
    );

  if (
    pointer.length <
    POINTER_DIMENSION
  ) {
    throw new Error(
      "SAM 2.1 object pointer is shorter than 256 values.",
    );
  }

  const maskSide =
    Math.sqrt(
      logits.length,
    );

  if (
    !Number.isInteger(
      maskSide,
    )
  ) {
    throw new Error(
      "SAM 2.1 low-resolution mask is not square.",
    );
  }

  return {
    mask: {
      logits,
      width:
        maskSide,
      height:
        maskSide,
      iou,
      objectScore,
    },
    highResolution,
    pointer:
      pointer.slice(
        0,
        POINTER_DIMENSION,
      ),
    objectScore,
  };
};

class SamMemoryBank {
  #conditioning:
    StoredMemory |
    undefined;

  #recent:
    StoredMemory[] = [];

  constructor(
    private readonly temporal:
      readonly (
        readonly number[]
      )[],
    private readonly featureTokens:
      number,
  ) {}

  condition(
    memory: StoredMemory,
  ): void {
    this.#conditioning =
      memory;

    this.#recent = [];
  }

  push(
    memory: StoredMemory,
  ): void {
    this.#recent.push(
      memory,
    );

    while (
      this.#recent.length >
      MAX_POINTERS - 1
    ) {
      this.#recent.shift();
    }
  }

  rewind(): void {
    this.#recent = [];
  }

  assemble(
    index: number,
    totalFrames: number,
  ): SamMemoryAssembly {
    const conditioning =
      this.#conditioning;

    if (
      conditioning ===
      undefined
    ) {
      throw new Error(
        "SAM 2.1 memory has no conditioning frame.",
      );
    }

    const temporalLast =
      this.temporal[
        this.temporal.length -
          1
      ];

    if (
      temporalLast ===
      undefined
    ) {
      throw new Error(
        "SAM 2.1 temporal table is empty.",
      );
    }

    const spatialBlocks:
      {
        readonly tokens:
          Float32Array;
        readonly positions:
          Float32Array;
      }[] = [
        {
          tokens:
            conditioning.tokens,
          positions:
            temporalPositions(
              conditioning.positions,
              temporalLast,
              MEMORY_DIMENSION,
            ),
        },
      ];

    const newestFirst =
      [...this.#recent].reverse();

    for (
      let slot = 1;
      slot <
      MEMORY_FRAMES;
      slot += 1
    ) {
      const entry =
        newestFirst[
          slot - 1
        ];

      if (
        entry !== undefined
      ) {
        spatialBlocks.push({
          tokens:
            entry.tokens,
          positions:
            temporalPositions(
              entry.positions,
              this.temporal[
                slot - 1
              ] ??
                [],
              MEMORY_DIMENSION,
            ),
        });

        continue;
      }

      spatialBlocks.push(
        spatialBlocks[1] ??
          spatialBlocks[0]!,
      );
    }

    const pointers =
      [
        conditioning,
        ...newestFirst,
      ].slice(
        0,
        MAX_POINTERS,
      );

    while (
      pointers.length <
      MAX_POINTERS
    ) {
      pointers.push(
        pointers[
          pointers.length -
            1
        ]!,
      );
    }

    const span =
      Math.max(
        1,
        Math.min(
          totalFrames,
          MAX_POINTERS,
        ) - 1,
      );

    const normalizedPointerDiffs =
      Float32Array.from(
        pointers.map(
          (memory) =>
            Math.abs(
              index -
                memory.index,
            ) /
            span,
        ),
      );

    const spatial =
      concatenateFloat32(
        spatialBlocks.map(
          (block) =>
            block.tokens,
        ),
      );

    const spatialPositions =
      concatenateFloat32(
        spatialBlocks.map(
          (block) =>
            block.positions,
        ),
      );

    const pointerValues =
      concatenateFloat32(
        pointers.map(
          (memory) =>
            memory.pointer,
        ),
      );

    if (
      spatial.length !==
      MEMORY_FRAMES *
        this.featureTokens *
        MEMORY_DIMENSION
    ) {
      throw new Error(
        "SAM 2.1 spatial memory geometry is invalid.",
      );
    }

    return {
      memory:
        concatenateFloat32([
          spatial,
          pointerValues,
        ]),
      memoryPositions:
        spatialPositions,
      normalizedPointerDiffs,
    };
  }
}

const expandPointerPositions = (
  pointerPositions:
    Float32Array,
): Float32Array => {
  if (
    pointerPositions.length !==
    MAX_POINTERS *
      MEMORY_DIMENSION
  ) {
    throw new Error(
      "SAM 2.1 pointer temporal output has unexpected geometry.",
    );
  }

  const expanded =
    new Float32Array(
      MAX_POINTERS *
        POINTER_TOKENS *
        MEMORY_DIMENSION,
    );

  for (
    let pointer = 0;
    pointer <
    MAX_POINTERS;
    pointer += 1
  ) {
    const row =
      pointerPositions.subarray(
        pointer *
          MEMORY_DIMENSION,
        (pointer + 1) *
          MEMORY_DIMENSION,
      );

    for (
      let token = 0;
      token <
      POINTER_TOKENS;
      token += 1
    ) {
      expanded.set(
        row,
        (
          pointer *
            POINTER_TOKENS +
          token
        ) *
          MEMORY_DIMENSION,
      );
    }
  }

  return expanded;
};

export const createSam21Adapter =
  async (
    candidate:
      VideoSegmentationCandidate,
    onProgress?: (
      progress: number,
    ) => void,
  ): Promise<VideoSegmentationAdapter> => {
    configureVideoOrt();

    const constants =
      await fetchVideoModelConstants(
        candidate,
      );

    const roles =
      [
        "vision-encoder",
        "mask-decoder",
        "memory-attention",
        "memory-encoder",
        "pointer-tpos",
      ] as const;

    const loaded:
      ort.InferenceSession[] = [];

    const load = async (
      role:
        (typeof roles)[number],
    ) => {
      const session =
        await createVideoSession(
          candidate,
          role,
        );

      loaded.push(
        session,
      );

      onProgress?.(
        loaded.length /
          roles.length,
      );

      return session;
    };

    let sessions:
      SamSessions;

    try {
      sessions = {
        visionEncoder:
          await load(
            "vision-encoder",
          ),
        maskDecoder:
          await load(
            "mask-decoder",
          ),
        memoryAttention:
          await load(
            "memory-attention",
          ),
        memoryEncoder:
          await load(
            "memory-encoder",
          ),
        pointerTpos:
          await load(
            "pointer-tpos",
          ),
      };
    } catch (error) {
      await closeVideoSessions({
        "vision-encoder":
          loaded[0],
        "mask-decoder":
          loaded[1],
        "memory-attention":
          loaded[2],
        "memory-encoder":
          loaded[3],
        "pointer-tpos":
          loaded[4],
      });

      throw error;
    }

    const featureSide =
      candidate.inputSize /
      16;

    const featureTokens =
      featureSide *
      featureSide;

    const memoryRows =
      MEMORY_FRAMES *
        featureTokens +
      MAX_POINTERS *
        POINTER_TOKENS;

    const bank =
      new SamMemoryBank(
        constants
          .memory_temporal_positional_encoding,
        featureTokens,
      );

    const encode =
      async (
        frame: VideoFrame,
      ): Promise<SamVision> => {
        const outputs =
          await sessions.visionEncoder.run({
            pixel_values:
              new ort.Tensor(
                "float32",
                frameToNchw(
                  frame,
                  candidate.inputSize,
                  constants.image_mean,
                  constants.image_std,
                ),
                [
                  1,
                  3,
                  candidate.inputSize,
                  candidate.inputSize,
                ],
              ),
          });

        return {
          feats0:
            requireTensor(
              outputs,
              "feats0",
            ),
          feats1:
            requireTensor(
              outputs,
              "feats1",
            ),
          feats2:
            requireTensor(
              outputs,
              "feats2",
            ),
          feats2NoMemory:
            requireTensor(
              outputs,
              "feats2_no_mem",
            ),
          position:
            requireTensor(
              outputs,
              "vision_pos_embed",
            ),
        };
      };

    const decode =
      async (
        vision:
          SamVision,
        conditioned:
          ort.Tensor,
        prompt:
          ReturnType<
            typeof pointPromptTensors
          >,
      ): Promise<SamDecoded> =>
        decodedMask(
          await sessions.maskDecoder.run({
            feats0:
              vision.feats0,
            feats1:
              vision.feats1,
            feats2_cond:
              conditioned,
            input_points:
              prompt.points,
            input_labels:
              prompt.labels,
          }),
        );

    const remember =
      async (
        vision:
          SamVision,
        decoded:
          SamDecoded,
        index: number,
        prompted: boolean,
      ): Promise<StoredMemory> => {
        const outputs =
          await sessions.memoryEncoder.run({
            feats2:
              vision.feats2,
            high_res_mask:
              new ort.Tensor(
                "float32",
                decoded.highResolution,
                [
                  1,
                  1,
                  candidate.inputSize,
                  candidate.inputSize,
                ],
              ),
            object_score_logits:
              new ort.Tensor(
                "float32",
                Float32Array.of(
                  decoded.objectScore,
                ),
                [
                  1,
                  1,
                ],
              ),
            binarize:
              new ort.Tensor(
                "float32",
                Float32Array.of(
                  prompted
                    ? 1
                    : 0,
                ),
                [],
              ),
          });

        const tokens =
          floatData(
            requireTensor(
              outputs,
              "memory_tokens",
            ),
            "SAM 2.1 memory_tokens",
          ).slice();

        const positions =
          floatData(
            requireTensor(
              outputs,
              "memory_pos",
            ),
            "SAM 2.1 memory_pos",
          ).slice();

        if (
          tokens.length !==
            featureTokens *
              MEMORY_DIMENSION ||
          positions.length !==
            featureTokens *
              MEMORY_DIMENSION
        ) {
          throw new Error(
            "SAM 2.1 memory encoder returned unexpected geometry.",
          );
        }

        return {
          index,
          tokens,
          positions,
          pointer:
            decoded.pointer,
        };
      };

    return {
      candidate,

      async seed(
        frame,
        prompt:
          VideoSegmentationPrompt,
        frameIndex,
      ) {
        if (
          prompt.proposalIndex !==
            undefined &&
          prompt.proposalIndex !==
            0
        ) {
          throw new Error(
            "This SAM 2.1 export returns one seed proposal; only proposal 0 is available.",
          );
        }

        const vision =
          await encode(
            frame,
          );

        const decoded =
          await decode(
            vision,
            vision.feats2NoMemory,
            pointPromptTensors(
              prompt.points,
              candidate.inputSize,
            ),
          );

        bank.condition(
          await remember(
            vision,
            decoded,
            frameIndex,
            true,
          ),
        );

        return decoded.mask;
      },

      async track(
        frame,
        frameIndex,
        totalFrames,
      ) {
        const vision =
          await encode(
            frame,
          );

        const assembled =
          bank.assemble(
            frameIndex,
            totalFrames,
          );

        const pointerOutput =
          await sessions.pointerTpos.run({
            normalized_diffs:
              new ort.Tensor(
                "float32",
                assembled.normalizedPointerDiffs,
                [
                  MAX_POINTERS,
                ],
              ),
          });

        const pointerPositions =
          expandPointerPositions(
            floatData(
              requireTensor(
                pointerOutput,
                "pointer_pos",
              ),
              "SAM 2.1 pointer_pos",
            ),
          );

        const memoryPositions =
          concatenateFloat32([
            assembled.memoryPositions,
            pointerPositions,
          ]);

        if (
          memoryPositions.length !==
          memoryRows *
            MEMORY_DIMENSION
        ) {
          throw new Error(
            "SAM 2.1 memory position geometry is invalid.",
          );
        }

        const attention =
          await sessions.memoryAttention.run({
            current_vision_features:
              new ort.Tensor(
                "float32",
                channelsToTokens(
                  floatData(
                    vision.feats2,
                    "SAM 2.1 feats2",
                  ),
                  FEATURE_CHANNELS,
                  featureTokens,
                ),
                [
                  featureTokens,
                  1,
                  FEATURE_CHANNELS,
                ],
              ),
            current_vision_position_embeddings:
              new ort.Tensor(
                "float32",
                channelsToTokens(
                  floatData(
                    vision.position,
                    "SAM 2.1 vision_pos_embed",
                  ),
                  FEATURE_CHANNELS,
                  featureTokens,
                ),
                [
                  featureTokens,
                  1,
                  FEATURE_CHANNELS,
                ],
              ),
            memory:
              new ort.Tensor(
                "float32",
                assembled.memory,
                [
                  memoryRows,
                  1,
                  MEMORY_DIMENSION,
                ],
              ),
            memory_pos:
              new ort.Tensor(
                "float32",
                memoryPositions,
                [
                  memoryRows,
                  1,
                  MEMORY_DIMENSION,
                ],
              ),
          });

        const decoded =
          await decode(
            vision,
            requireTensor(
              attention,
              "conditioned_feats",
            ),
            pointPromptTensors(
              [
                {
                  x: 0,
                  y: 0,
                  label: -1,
                },
              ],
              candidate.inputSize,
            ),
          );

        if (
          decoded.objectScore >
            0 &&
          (decoded.mask.iou ??
            0) >=
            RELIABLE_IOU
        ) {
          bank.push(
            await remember(
              vision,
              decoded,
              frameIndex,
              false,
            ),
          );
        }

        return decoded.mask;
      },

      rewind() {
        bank.rewind();
      },

      async close() {
        await closeVideoSessions({
          "vision-encoder":
            sessions.visionEncoder,
          "mask-decoder":
            sessions.maskDecoder,
          "memory-attention":
            sessions.memoryAttention,
          "memory-encoder":
            sessions.memoryEncoder,
          "pointer-tpos":
            sessions.pointerTpos,
        });
      },
    };
  };
