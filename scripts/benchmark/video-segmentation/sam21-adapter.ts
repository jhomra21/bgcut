import * as ort from "onnxruntime-web/webgpu";

import {
  createSamFeatureTransposer,
  requireGpuBuffer,
  type SamFeatureTransposer,
} from "./sam21-gpu";

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
  VideoSegmentationAdapterOptions,
  VideoSegmentationCandidate,
  VideoSegmentationMask,
  VideoSegmentationPrompt,
  VideoSegmentationSubjectPrompt,
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

const VISION_OUTPUTS = [
  "feats0",
  "feats1",
  "feats2",
  "feats2_no_mem",
] as const;

const VISION_OUTPUTS_WITH_POSITION = [
  ...VISION_OUTPUTS,
  "vision_pos_embed",
] as const;

const MEMORY_OUTPUTS = [
  "memory_tokens",
] as const;

const MEMORY_OUTPUTS_WITH_POSITION = [
  ...MEMORY_OUTPUTS,
  "memory_pos",
] as const;

type SamPromptSessions = {
  readonly visionEncoder:
    ort.InferenceSession;
  readonly maskDecoder:
    ort.InferenceSession;
};

type SamTrackingSessions = {
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
    Float32Array;
};

const disposeVision = (
  vision:
    SamVision,
): void => {
  vision.feats0.dispose();
  vision.feats1.dispose();
  vision.feats2.dispose();
  vision.feats2NoMemory.dispose();
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
    options?:
      VideoSegmentationAdapterOptions,
  ): Promise<VideoSegmentationAdapter> => {
    configureVideoOrt();

    const constants =
      await fetchVideoModelConstants(
        candidate,
      );

    const timingTotals:
      Record<
        string,
        {
          calls: number;
          totalMs: number;
        }
      > = {};

    const recordTiming = (
      stage: string,
      startedAt: number,
    ) => {
      const current =
        timingTotals[
          stage
        ] ?? {
          calls: 0,
          totalMs: 0,
        };

      current.calls +=
        1;

      current.totalMs +=
        performance.now() -
        startedAt;

      timingTotals[
        stage
      ] =
        current;
    };

    const timingSnapshot =
      () =>
        Object.fromEntries(
          Object.entries(
            timingTotals,
          ).map(
            (
              [
                stage,
                timing,
              ],
            ) => [
              stage,
              {
                calls:
                  timing.calls,
                totalMs:
                  timing.totalMs,
              },
            ],
          ),
        );

    const roles =
      [
        "vision-encoder",
        "mask-decoder",
        "memory-attention",
        "memory-encoder",
        "pointer-tpos",
      ] as const;

    const loaded =
      new Map<
        (typeof roles)[number],
        ort.InferenceSession
      >();

    const preferredOutputLocation = (
      role:
        (typeof roles)[number],
    ):
      ort.InferenceSession.SessionOptions[
        "preferredOutputLocation"
      ] => {
      if (
        options?.gpuFeatureHandoff !==
        true
      ) {
        return undefined;
      }

      if (
        role ===
        "vision-encoder"
      ) {
        return {
          feats0:
            "gpu-buffer",
          feats1:
            "gpu-buffer",
          feats2:
            "gpu-buffer",
          feats2_no_mem:
            "gpu-buffer",
        };
      }

      if (
        role ===
        "memory-attention"
      ) {
        return {
          conditioned_feats:
            "gpu-buffer",
        };
      }

      return undefined;
    };

    const load = async (
      role:
        (typeof roles)[number],
    ) => {
      const session =
        await createVideoSession(
          candidate,
          role,
          preferredOutputLocation(
            role,
          ),
        );

      loaded.set(
        role,
        session,
      );

      onProgress?.(
        loaded.size /
          roles.length,
      );

      return session;
    };

    let promptSessions:
      SamPromptSessions;

    try {
      promptSessions = {
        visionEncoder:
          await load(
            "vision-encoder",
          ),
        maskDecoder:
          await load(
            "mask-decoder",
          ),
      };
    } catch (error) {
      await closeVideoSessions({
        "vision-encoder":
          loaded.get(
            "vision-encoder",
          ),
        "mask-decoder":
          loaded.get(
            "mask-decoder",
          ),
      });

      throw error;
    }

    let trackingSessionsPromise:
      Promise<SamTrackingSessions> |
      undefined;

    const loadTrackingSessions =
      async (): Promise<
        SamTrackingSessions
      > => {
        try {
          return {
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
            "memory-attention":
              loaded.get(
                "memory-attention",
              ),
            "memory-encoder":
              loaded.get(
                "memory-encoder",
              ),
            "pointer-tpos":
              loaded.get(
                "pointer-tpos",
              ),
          });

          loaded.delete(
            "memory-attention",
          );

          loaded.delete(
            "memory-encoder",
          );

          loaded.delete(
            "pointer-tpos",
          );

          throw error;
        }
      };

    const getTrackingSessions =
      (): Promise<
        SamTrackingSessions
      > => {
        if (
          trackingSessionsPromise ===
          undefined
        ) {
          trackingSessionsPromise =
            loadTrackingSessions().catch(
              (error) => {
                trackingSessionsPromise =
                  undefined;

                throw error;
              },
            );
        }

        return trackingSessionsPromise;
      };

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

    const createBank =
      () =>
        new SamMemoryBank(
          constants
            .memory_temporal_positional_encoding,
          featureTokens,
        );

    const bank =
      createBank();

    const subjectBanks =
      new Map<
        string,
        SamMemoryBank
      >();

    let seedFrame: VideoFrame | undefined;
    let seedVision: SamVision | undefined;

    let visionPosition:
      Float32Array |
      undefined;

    let memoryPosition:
      Float32Array |
      undefined;

    let promptPipelineWarm = false;

    const encode =
      async (
        frame: VideoFrame,
      ): Promise<SamVision> => {
        const pixelValues =
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
          );

        const runStartedAt =
          performance.now();

        const needsPosition =
          visionPosition ===
          undefined;

        const outputs =
          await promptSessions.visionEncoder.run(
            {
              pixel_values:
                pixelValues,
            },
            needsPosition
              ? VISION_OUTPUTS_WITH_POSITION
              : VISION_OUTPUTS,
          );

        recordTiming(
          "vision-encoder",
          runStartedAt,
        );

        if (
          needsPosition
        ) {
          visionPosition =
            floatData(
              requireTensor(
                outputs,
                "vision_pos_embed",
              ),
              "SAM 2.1 vision_pos_embed",
            ).slice();
        }

        if (
          visionPosition ===
          undefined
        ) {
          throw new Error(
            "SAM 2.1 vision position cache was not initialized.",
          );
        }

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
            visionPosition,
        };
      };

    const getSeedVision =
      async (
        frame:
          VideoFrame,
      ): Promise<SamVision> => {
        if (
          seedFrame ===
            frame &&
          seedVision !==
            undefined
        ) {
          return seedVision;
        }

        const next =
          await encode(
            frame,
          );

        const previous =
          seedVision;

        seedFrame =
          frame;

        seedVision =
          next;

        if (
          previous !==
          undefined
        ) {
          disposeVision(
            previous,
          );
        }

        return next;
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
      ): Promise<SamDecoded> => {
        const runStartedAt =
          performance.now();

        const outputs =
          await promptSessions.maskDecoder.run({
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
          });

        recordTiming(
          "mask-decoder",
          runStartedAt,
        );

        return decodedMask(
          outputs,
        );
      };

    const remember =
      async (
        vision:
          SamVision,
        decoded:
          SamDecoded,
        index: number,
        prompted: boolean,
      ): Promise<StoredMemory> => {
        const trackingSessions =
          await getTrackingSessions();

        const memoryInputs = {
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
        };

        const runStartedAt =
          performance.now();

        const needsPosition =
          memoryPosition ===
          undefined;

        const outputs =
          await trackingSessions.memoryEncoder.run(
            memoryInputs,
            needsPosition
              ? MEMORY_OUTPUTS_WITH_POSITION
              : MEMORY_OUTPUTS,
          );

        recordTiming(
          "memory-encoder",
          runStartedAt,
        );

        const tokens =
          floatData(
            requireTensor(
              outputs,
              "memory_tokens",
            ),
            "SAM 2.1 memory_tokens",
          ).slice();

        if (
          needsPosition
        ) {
          memoryPosition =
            floatData(
              requireTensor(
                outputs,
                "memory_pos",
              ),
              "SAM 2.1 memory_pos",
            ).slice();
        }

        if (
          memoryPosition ===
          undefined
        ) {
          throw new Error(
            "SAM 2.1 memory position cache was not initialized.",
          );
        }

        if (
          tokens.length !==
            featureTokens *
              MEMORY_DIMENSION ||
          memoryPosition.length !==
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
          positions:
            memoryPosition,
          pointer:
            decoded.pointer,
        };
      };

    const validatePrompt =
      (
        prompt:
          VideoSegmentationPrompt,
      ) => {
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
      };

    const seedWithBank =
      async (
        vision: SamVision,
        targetBank:
          SamMemoryBank,
        prompt:
          VideoSegmentationPrompt,
        frameIndex: number,
      ): Promise<
        VideoSegmentationMask
      > => {
        validatePrompt(
          prompt,
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

        targetBank.condition(
          await remember(
            vision,
            decoded,
            frameIndex,
            true,
          ),
        );

        return decoded.mask;
      };

    const trackWithBank =
      async (
        vision: SamVision,
        targetBank:
          SamMemoryBank,
        frameIndex: number,
        totalFrames: number,
      ): Promise<
        VideoSegmentationMask
      > => {
        const trackingSessions =
          await getTrackingSessions();

        const assembled =
          targetBank.assemble(
            frameIndex,
            totalFrames,
          );

        const pointerInputs = {
          normalized_diffs:
            new ort.Tensor(
              "float32",
              assembled.normalizedPointerDiffs,
              [
                MAX_POINTERS,
              ],
            ),
        };

        let runStartedAt =
          performance.now();

        const pointerOutput =
          await trackingSessions.pointerTpos.run(
            pointerInputs,
          );

        recordTiming(
          "pointer-tpos",
          runStartedAt,
        );

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

        const attentionInputs = {
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
                vision.position,
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
        };

        runStartedAt =
          performance.now();

        const attention =
          await trackingSessions.memoryAttention.run(
            attentionInputs,
          );

        recordTiming(
          "memory-attention",
          runStartedAt,
        );

        const conditioned =
          requireTensor(
            attention,
            "conditioned_feats",
          );

        let decoded:
          SamDecoded;

        try {
          decoded =
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
        } finally {
          conditioned.dispose();
        }

        if (
          decoded.objectScore >
            0 &&
          (decoded.mask.iou ??
            0) >=
            RELIABLE_IOU
        ) {
          targetBank.push(
            await remember(
              vision,
              decoded,
              frameIndex,
              false,
            ),
          );
        }

        return decoded.mask;
      };

    return {
      candidate,
      timingSnapshot,

      async prepareFrame(
        frame,
      ) {
        const encodeStartedAt =
          performance.now();

        const currentSeedVision =
          await getSeedVision(
            frame,
          );

        const encodedAt =
          performance.now();

        let promptWarmMs =
          0;

        if (
          !promptPipelineWarm
        ) {
          const promptStartedAt =
            performance.now();

          await decode(
            currentSeedVision,
            currentSeedVision.feats2NoMemory,
            pointPromptTensors(
              [
                {
                  x: 0.5,
                  y: 0.5,
                  label: 1,
                },
              ],
              candidate.inputSize,
            ),
          );

          promptWarmMs =
            performance.now() -
            promptStartedAt;

          // Selection preview only needs vision + prompt decoding. Temporal memory warms during export.
          promptPipelineWarm =
            true;
        }

        return {
          encodeMs:
            encodedAt -
            encodeStartedAt,
          promptWarmMs,
        };
      },

      async prepareTracking() {
        await getTrackingSessions();
      },

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

        try {
          return await seedWithBank(
            vision,
            bank,
            prompt,
            frameIndex,
          );
        } finally {
          disposeVision(
            vision,
          );
        }
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

        try {
          return await trackWithBank(
            vision,
            bank,
            frameIndex,
            totalFrames,
          );
        } finally {
          disposeVision(
            vision,
          );
        }
      },

      async previewSubjects(
        frame,
        subjects:
          readonly VideoSegmentationSubjectPrompt[],
      ) {
        if (
          subjects.length ===
          0
        ) {
          throw new Error(
            "SAM 2.1 subject preview requires at least one subject.",
          );
        }

        const identifiers =
          new Set(
            subjects.map(
              (subject) =>
                subject.id,
            ),
          );

        if (
          identifiers.size !==
          subjects.length
        ) {
          throw new Error(
            "SAM 2.1 subject identifiers must be unique.",
          );
        }

        const vision =
          await getSeedVision(
            frame,
          );

        const masks:
          VideoSegmentationMask[] =
            [];

        for (
          const subject of
          subjects
        ) {
          validatePrompt(
            subject.prompt,
          );

          const decoded =
            await decode(
              vision,
              vision.feats2NoMemory,
              pointPromptTensors(
                subject.prompt.points,
                candidate.inputSize,
              ),
            );

          masks.push(
            decoded.mask,
          );
        }

        return masks;
      },

      async seedSubjects(
        frame,
        subjects:
          readonly VideoSegmentationSubjectPrompt[],
        frameIndex,
      ) {
        if (
          subjects.length ===
          0
        ) {
          throw new Error(
            "SAM 2.1 multi-subject tracking requires at least one subject.",
          );
        }

        const identifiers =
          new Set(
            subjects.map(
              (subject) =>
                subject.id,
            ),
          );

        if (
          identifiers.size !==
          subjects.length
        ) {
          throw new Error(
            "SAM 2.1 subject identifiers must be unique.",
          );
        }

        const vision =
          await getSeedVision(
            frame,
          );

        subjectBanks.clear();

        const masks:
          VideoSegmentationMask[] =
            [];

        for (
          const subject of
          subjects
        ) {
          const subjectBank =
            createBank();

          subjectBanks.set(
            subject.id,
            subjectBank,
          );

          masks.push(
            await seedWithBank(
              vision,
              subjectBank,
              subject.prompt,
              frameIndex,
            ),
          );
        }

        return masks;
      },

      async trackSubjects(
        frame,
        frameIndex,
        totalFrames,
      ) {
        if (
          subjectBanks.size ===
          0
        ) {
          throw new Error(
            "SAM 2.1 has no seeded subjects to track.",
          );
        }

        const vision =
          await encode(
            frame,
          );

        const masks:
          VideoSegmentationMask[] =
            [];

        try {
          for (
            const subjectBank of
            subjectBanks.values()
          ) {
            masks.push(
              await trackWithBank(
                vision,
                subjectBank,
                frameIndex,
                totalFrames,
              ),
            );
          }

          return masks;
        } finally {
          disposeVision(
            vision,
          );
        }
      },

      rewind() {
        bank.rewind();
      },

      rewindSubjects() {
        for (
          const subjectBank of
          subjectBanks.values()
        ) {
          subjectBank.rewind();
        }
      },

      async close() {
        seedFrame = undefined;

        if (
          seedVision !==
          undefined
        ) {
          disposeVision(
            seedVision,
          );

          seedVision =
            undefined;
        }

        subjectBanks.clear();

        await trackingSessionsPromise?.catch(
          () => undefined,
        );

        await closeVideoSessions({
          "vision-encoder":
            loaded.get(
              "vision-encoder",
            ),
          "mask-decoder":
            loaded.get(
              "mask-decoder",
            ),
          "memory-attention":
            loaded.get(
              "memory-attention",
            ),
          "memory-encoder":
            loaded.get(
              "memory-encoder",
            ),
          "pointer-tpos":
            loaded.get(
              "pointer-tpos",
            ),
        });
      },
    };

  };
