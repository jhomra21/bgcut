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
  tokensToChannels,
} from "./runtime-common";

import type {
  VideoSegmentationAdapter,
  VideoSegmentationCandidate,
  VideoSegmentationMask,
  VideoSegmentationPrompt,
} from "./types";

const FEATURE_CHANNELS = 256;

const FEATURE_SIDE = 64;

const FEATURE_TOKENS =
  FEATURE_SIDE *
  FEATURE_SIDE;

const MEMORY_DIMENSION = 64;

const MEMORY_TOKENS = 512;

const MAX_RECENT = 6;

const MAX_POINTERS = 16;

const POINTER_DIMENSION = 256;

const POINTER_TOKENS =
  POINTER_DIMENSION /
  MEMORY_DIMENSION;

type EdgeSessions = {
  readonly visionEncoder:
    ort.InferenceSession;
  readonly maskDecoder:
    ort.InferenceSession;
  readonly memoryAttention:
    ort.InferenceSession;
  readonly memoryEncoder:
    ort.InferenceSession;
};

type EncodedFrame = {
  readonly feats0: ort.Tensor;
  readonly feats1: ort.Tensor;
  readonly feats2: ort.Tensor;
  readonly pos2: ort.Tensor;
};

type DecodedFrame = {
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

type EdgeMemoryAssembly = {
  readonly spatial:
    Float32Array;
  readonly spatialPositions:
    Float32Array;
  readonly pointers:
    Float32Array;
  readonly pointerPositions:
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
      `EdgeTAM output "${name}" is missing.`,
    );
  }

  return tensor;
};

const squareSide = (
  length: number,
  label: string,
): number => {
  const side =
    Math.sqrt(length);

  if (
    !Number.isInteger(
      side,
    )
  ) {
    throw new Error(
      `${label} is not square.`,
    );
  }

  return side;
};

const selectCandidate = (
  values: Float32Array,
  candidateCount: number,
  candidate: number,
  label: string,
): Float32Array => {
  if (
    candidateCount < 1 ||
    values.length %
      candidateCount !==
      0
  ) {
    throw new Error(
      `${label} cannot be split across ${candidateCount} candidates.`,
    );
  }

  const length =
    values.length /
    candidateCount;

  return values.slice(
    candidate *
      length,
    (candidate + 1) *
      length,
  );
};

const decodeMaskOutputs = (
  outputs:
    Record<
      string,
      ort.Tensor
    >,
): DecodedFrame => {
  const iouScores =
    floatData(
      requireTensor(
        outputs,
        "iou_scores",
      ),
      "EdgeTAM iou_scores",
    );

  if (
    iouScores.length ===
    0
  ) {
    throw new Error(
      "EdgeTAM returned no mask candidates.",
    );
  }

  let best = 0;

  for (
    let index = 1;
    index <
    iouScores.length;
    index += 1
  ) {
    if (
      (iouScores[index] ??
        Number.NEGATIVE_INFINITY) >
      (iouScores[best] ??
        Number.NEGATIVE_INFINITY)
    ) {
      best = index;
    }
  }

  const lowResolution =
    selectCandidate(
      floatData(
        requireTensor(
          outputs,
          "pred_masks",
        ),
        "EdgeTAM pred_masks",
      ),
      iouScores.length,
      best,
      "EdgeTAM pred_masks",
    );

  const highResolution =
    selectCandidate(
      floatData(
        requireTensor(
          outputs,
          "high_res_masks",
        ),
        "EdgeTAM high_res_masks",
      ),
      iouScores.length,
      best,
      "EdgeTAM high_res_masks",
    );

  const objectScores =
    floatData(
      requireTensor(
        outputs,
        "object_score_logits",
      ),
      "EdgeTAM object_score_logits",
    );

  const pointerData =
    floatData(
      requireTensor(
        outputs,
        "object_pointer",
      ),
      "EdgeTAM object_pointer",
    );

  if (
    pointerData.length <
    POINTER_DIMENSION
  ) {
    throw new Error(
      "EdgeTAM object pointer is shorter than 256 values.",
    );
  }

  return {
    mask: {
      logits:
        lowResolution,
      width:
        squareSide(
          lowResolution.length,
          "EdgeTAM low-resolution mask",
        ),
      height:
        squareSide(
          lowResolution.length,
          "EdgeTAM low-resolution mask",
        ),
      iou:
        iouScores[best] ??
        0,
      objectScore:
        objectScores[0] ??
        0,
    },
    highResolution,
    pointer:
      pointerData.slice(
        0,
        POINTER_DIMENSION,
      ),
    objectScore:
      objectScores[0] ??
      0,
  };
};

class EdgeMemoryBank {
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
      MAX_RECENT
    ) {
      this.#recent.shift();
    }
  }

  rewind(): void {
    this.#recent = [];
  }

  assemble(
    index: number,
  ): EdgeMemoryAssembly {
    const conditioning =
      this.#conditioning;

    if (
      conditioning ===
      undefined
    ) {
      throw new Error(
        "EdgeTAM memory has no conditioning frame.",
      );
    }

    const blocks:
      StoredMemory[] = [
        conditioning,
      ];

    const positions:
      Float32Array[] = [
        temporalPositions(
          conditioning.positions,
          this.temporal[
            this.temporal.length -
              1
          ] ??
            [],
          MEMORY_DIMENSION,
        ),
      ];

    for (
      const memory of
      [...this.#recent].reverse()
    ) {
      const offset =
        index -
        memory.index;

      if (
        offset < 1 ||
        offset >
          MAX_RECENT
      ) {
        continue;
      }

      blocks.push(
        memory,
      );

      positions.push(
        temporalPositions(
          memory.positions,
          this.temporal[
            offset - 1
          ] ??
            [],
          MEMORY_DIMENSION,
        ),
      );
    }

    const pointerMemories =
      [
        conditioning,
        ...[...this.#recent].reverse(),
      ].slice(
        0,
        MAX_POINTERS,
      );

    const pointers =
      concatenateFloat32(
        pointerMemories.map(
          (memory) =>
            memory.pointer,
        ),
      );

    return {
      spatial:
        concatenateFloat32(
          blocks.map(
            (memory) =>
              memory.tokens,
          ),
        ),
      spatialPositions:
        concatenateFloat32(
          positions,
        ),
      pointers,
      pointerPositions:
        new Float32Array(
          pointerMemories.length *
            POINTER_TOKENS *
            MEMORY_DIMENSION,
        ),
    };
  }
}

export const createEdgeTamAdapter =
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
      EdgeSessions;

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
      });

      throw error;
    }

    const bank =
      new EdgeMemoryBank(
        constants
          .memory_temporal_positional_encoding,
      );

    const encode =
      async (
        frame: VideoFrame,
      ): Promise<EncodedFrame> => {
        const pixels =
          frameToNchw(
            frame,
            candidate.inputSize,
            constants.image_mean,
            constants.image_std,
          );

        const outputs =
          await sessions.visionEncoder.run({
            pixel_values:
              new ort.Tensor(
                "float32",
                pixels,
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
          pos2:
            requireTensor(
              outputs,
              "pos2",
            ),
        };
      };

    const decode =
      async (
        vision:
          EncodedFrame,
        conditioned:
          ort.Tensor,
        prompt:
          ReturnType<
            typeof pointPromptTensors
          >,
      ): Promise<DecodedFrame> =>
        decodeMaskOutputs(
          await sessions.maskDecoder.run({
            feats0:
              vision.feats0,
            feats1:
              vision.feats1,
            feats2:
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
          EncodedFrame,
        decoded:
          DecodedFrame,
        index: number,
        prompted: boolean,
      ): Promise<StoredMemory> => {
        const outputs =
          await sessions.memoryEncoder.run({
            vision_features:
              vision.feats2,
            pred_masks_high_res:
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
            is_mask_from_pts:
              new ort.Tensor(
                "bool",
                Uint8Array.of(
                  prompted
                    ? 1
                    : 0,
                ),
                [
                  1,
                ],
              ),
          });

        const tokens =
          floatData(
            requireTensor(
              outputs,
              "memory_tokens",
            ),
            "EdgeTAM memory_tokens",
          ).slice();

        const positions =
          floatData(
            requireTensor(
              outputs,
              "memory_pos_enc",
            ),
            "EdgeTAM memory_pos_enc",
          ).slice();

        if (
          tokens.length !==
            MEMORY_TOKENS *
              MEMORY_DIMENSION ||
          positions.length !==
            MEMORY_TOKENS *
              MEMORY_DIMENSION
        ) {
          throw new Error(
            "EdgeTAM memory encoder returned unexpected geometry.",
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
        const vision =
          await encode(
            frame,
          );

        const promptTensors =
          pointPromptTensors(
            prompt.points,
            candidate.inputSize,
          );

        const decoded =
          await decode(
            vision,
            vision.feats2,
            promptTensors,
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
      ) {
        const vision =
          await encode(
            frame,
          );

        const assembled =
          bank.assemble(
            frameIndex,
          );

        const currentFeatures =
          channelsToTokens(
            floatData(
              vision.feats2,
              "EdgeTAM feats2",
            ),
            FEATURE_CHANNELS,
            FEATURE_TOKENS,
          );

        const currentPositions =
          channelsToTokens(
            floatData(
              vision.pos2,
              "EdgeTAM pos2",
            ),
            FEATURE_CHANNELS,
            FEATURE_TOKENS,
          );

        const spatialRows =
          assembled.spatial.length /
          MEMORY_DIMENSION;

        const pointerRows =
          assembled.pointers.length /
          MEMORY_DIMENSION;

        const attention =
          await sessions.memoryAttention.run({
            current_vision_features:
              new ort.Tensor(
                "float32",
                currentFeatures,
                [
                  FEATURE_TOKENS,
                  1,
                  FEATURE_CHANNELS,
                ],
              ),
            current_vision_position_embeddings:
              new ort.Tensor(
                "float32",
                currentPositions,
                [
                  FEATURE_TOKENS,
                  1,
                  FEATURE_CHANNELS,
                ],
              ),
            spatial_memory:
              new ort.Tensor(
                "float32",
                assembled.spatial,
                [
                  spatialRows,
                  1,
                  MEMORY_DIMENSION,
                ],
              ),
            spatial_memory_position_embeddings:
              new ort.Tensor(
                "float32",
                assembled.spatialPositions,
                [
                  spatialRows,
                  1,
                  MEMORY_DIMENSION,
                ],
              ),
            pointer_memory:
              new ort.Tensor(
                "float32",
                assembled.pointers,
                [
                  pointerRows,
                  1,
                  MEMORY_DIMENSION,
                ],
              ),
            pointer_memory_position_embeddings:
              new ort.Tensor(
                "float32",
                assembled.pointerPositions,
                [
                  pointerRows,
                  1,
                  MEMORY_DIMENSION,
                ],
              ),
          });

        const conditionedTokens =
          floatData(
            requireTensor(
              attention,
              "conditioned_features",
            ),
            "EdgeTAM conditioned_features",
          );

        const conditioned =
          new ort.Tensor(
            "float32",
            tokensToChannels(
              conditionedTokens,
              FEATURE_CHANNELS,
              FEATURE_TOKENS,
            ),
            [
              1,
              FEATURE_CHANNELS,
              FEATURE_SIDE,
              FEATURE_SIDE,
            ],
          );

        const decoded =
          await decode(
            vision,
            conditioned,
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

        bank.push(
          await remember(
            vision,
            decoded,
            frameIndex,
            false,
          ),
        );

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
        });
      },
    };
  };
