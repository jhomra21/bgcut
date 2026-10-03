import { Schema } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import {
  artifactFor,
  channelsToTokens,
  closeVideoSessions,
  configureVideoOrt,
  createVideoSession,
  floatData,
  frameToNchw,
  tokensToChannels,
} from "./runtime-common";

import {
  browserVideoModelUrl,
} from "./model-delivery";

import type {
  VideoSegmentationAdapter,
  VideoSegmentationCandidate,
  VideoSegmentationPrompt,
} from "./types";

const FEATURE_CHANNELS = 256;

const FEATURE_SIDE = 64;

const FEATURE_TOKENS =
  FEATURE_SIDE *
  FEATURE_SIDE;

const MASK_SIDE = 256;

const MEMORY_MASK_SIDE = 1024;

const MEMORY_DIMENSION = 64;

const MEMORY_ENTRY_TOKENS = 512;

const MEMORY_ENTRIES = 7;

const RECENT_ENTRIES =
  MEMORY_ENTRIES - 1;

const POINTER_DIMENSION = 256;

const POINTER_SPLITS =
  POINTER_DIMENSION /
  MEMORY_DIMENSION;

const MAX_POINTERS = 16;

const POINTER_TOKENS =
  MAX_POINTERS *
  POINTER_SPLITS;

const MEMORY_TOKENS =
  MEMORY_ENTRIES *
    MEMORY_ENTRY_TOKENS +
  POINTER_TOKENS;

const POINTER_START =
  MEMORY_ENTRIES *
  MEMORY_ENTRY_TOKENS;

const MASKED_KEY = -1e4;

const NO_OBJECT_LOGIT = -1024;

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

const EdgeParametersSchema =
  Schema.Struct({
    parameters:
      Schema.Struct({
        no_memory_embedding:
          Schema.Array(
            Schema.Number,
          ),
        memory_temporal_positional_encoding:
          Schema.Array(
            Schema.Number,
          ),
        no_object_pointer:
          Schema.Array(
            Schema.Number,
          ),
      }),
    constants:
      Schema.Struct({
        sigmoid_scale_for_mem_enc:
          Schema.Number,
        sigmoid_bias_for_mem_enc:
          Schema.Number,
      }),
  });

type EdgeParameters =
  Schema.Schema.Type<
    typeof EdgeParametersSchema
  >;

type EdgeSessions = {
  readonly visionEncoder:
    ort.InferenceSession;
  readonly seedMaskDecoder:
    ort.InferenceSession;
  readonly trackedMaskDecoder:
    ort.InferenceSession;
  readonly memoryAttention:
    ort.InferenceSession;
  readonly memoryEncoder:
    ort.InferenceSession;
};

type EncodedFrame = {
  readonly fine0: ort.Tensor;
  readonly fine1: ort.Tensor;
  readonly top: ort.Tensor;
  readonly rawTop:
    Float32Array;
  readonly tokens:
    Float32Array;
};

type SelectedMask = {
  readonly logits:
    Float32Array;
  readonly iou: number;
  readonly objectScore:
    number | undefined;
  readonly alternatives:
    readonly {
      readonly logits:
        Float32Array;
      readonly iou: number;
    }[];
};

type TrackedMask = {
  readonly selected:
    SelectedMask;
  readonly pointer:
    Float32Array;
};

type MemoryEntry = {
  readonly features:
    Float32Array;
  readonly positions:
    Float32Array;
};

type EdgeMemoryAssembly = {
  readonly memory:
    Float32Array;
  readonly positions:
    Float32Array;
  readonly keyMask:
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

const requireLength = (
  values: readonly number[],
  expected: number,
  label: string,
): void => {
  if (
    values.length !==
    expected
  ) {
    throw new Error(
      `EdgeTAM ${label} has ${values.length} values; expected ${expected}.`,
    );
  }
};

const fetchParameters =
  async (
    candidate:
      VideoSegmentationCandidate,
  ): Promise<EdgeParameters> => {
    const artifact =
      artifactFor(
        candidate,
        "parameters",
      );

    const response =
      await fetch(
        browserVideoModelUrl(
          artifact.url,
        ),
        {
          cache:
            "force-cache",
        },
      );

    if (!response.ok) {
      throw new Error(
        `Could not fetch ${candidate.label} parameters: HTTP ${response.status}.`,
      );
    }

    const parameters =
      Schema.decodeUnknownSync(
        EdgeParametersSchema,
      )(
        await response.json(),
      );

    requireLength(
      parameters.parameters
        .no_memory_embedding,
      FEATURE_CHANNELS,
      "no-memory embedding",
    );

    requireLength(
      parameters.parameters
        .memory_temporal_positional_encoding,
      MEMORY_ENTRIES *
        MEMORY_DIMENSION,
      "temporal position table",
    );

    requireLength(
      parameters.parameters
        .no_object_pointer,
      POINTER_DIMENSION,
      "no-object pointer",
    );

    return parameters;
  };

const selectBestMask = (
  outputs:
    Record<
      string,
      ort.Tensor
    >,
  proposalIndex?: number,
): SelectedMask => {
  const scores =
    floatData(
      requireTensor(
        outputs,
        "iou_scores",
      ),
      "EdgeTAM iou_scores",
    );

  if (
    scores.length ===
    0
  ) {
    throw new Error(
      "EdgeTAM returned no mask candidates.",
    );
  }

  let best = 0;

  if (
    proposalIndex !==
    undefined
  ) {
    if (
      !Number.isInteger(
        proposalIndex,
      ) ||
      proposalIndex < 0 ||
      proposalIndex >=
        scores.length
    ) {
      throw new Error(
        `EdgeTAM seed proposal ${proposalIndex} is outside the ${scores.length} returned proposals.`,
      );
    }

    best =
      proposalIndex;
  } else {
    for (
      let index = 1;
      index <
      scores.length;
      index += 1
    ) {
      if (
        (scores[index] ??
          Number.NEGATIVE_INFINITY) >
        (scores[best] ??
          Number.NEGATIVE_INFINITY)
      ) {
        best = index;
      }
    }
  }

  const masks =
    floatData(
      requireTensor(
        outputs,
        "pred_masks",
      ),
      "EdgeTAM pred_masks",
    );

  if (
    masks.length %
      scores.length !==
      0
  ) {
    throw new Error(
      "EdgeTAM mask candidates do not match its IoU scores.",
    );
  }

  const stride =
    masks.length /
    scores.length;

  const side =
    Math.sqrt(
      stride,
    );

  if (
    side !==
    MASK_SIDE
  ) {
    throw new Error(
      `EdgeTAM mask side was ${side}; expected ${MASK_SIDE}.`,
    );
  }

  const objectScores =
    outputs.object_score_logits ===
    undefined
      ? undefined
      : floatData(
          outputs.object_score_logits,
          "EdgeTAM object_score_logits",
        );

  return {
    logits:
      masks.slice(
        best *
          stride,
        (best + 1) *
          stride,
      ),
    iou:
      scores[best] ??
      0,
    objectScore:
      objectScores?.[0],
    alternatives:
      Array.from(
        {
          length:
            scores.length,
        },
        (
          _,
          index,
        ) => ({
          logits:
            masks.slice(
              index *
                stride,
              (index + 1) *
                stride,
            ),
          iou:
            scores[index] ??
            0,
        }),
      ),
  };
};

const selectTrackedMask = (
  outputs:
    Record<
      string,
      ort.Tensor
    >,
): TrackedMask => {
  const selected =
    selectBestMask(
      outputs,
    );

  const scores =
    floatData(
      requireTensor(
        outputs,
        "iou_scores",
      ),
      "EdgeTAM iou_scores",
    );

  let best = 0;

  for (
    let index = 1;
    index <
    scores.length;
    index += 1
  ) {
    if (
      (scores[index] ??
        Number.NEGATIVE_INFINITY) >
      (scores[best] ??
        Number.NEGATIVE_INFINITY)
    ) {
      best = index;
    }
  }

  const pointers =
    floatData(
      requireTensor(
        outputs,
        "object_pointer",
      ),
      "EdgeTAM object_pointer",
    );

  if (
    pointers.length !==
    scores.length *
      POINTER_DIMENSION
  ) {
    throw new Error(
      "EdgeTAM object pointers do not match its mask candidates.",
    );
  }

  return {
    selected,
    pointer:
      pointers.slice(
        best *
          POINTER_DIMENSION,
        (best + 1) *
          POINTER_DIMENSION,
      ),
  };
};

const removeNoMemoryBias = (
  channels: Float32Array,
  bias: readonly number[],
): Float32Array => {
  if (
    channels.length !==
      FEATURE_CHANNELS *
        FEATURE_TOKENS ||
    bias.length !==
      FEATURE_CHANNELS
  ) {
    throw new Error(
      "EdgeTAM top feature geometry does not match the no-memory embedding.",
    );
  }

  const result =
    channels.slice();

  for (
    let channel = 0;
    channel <
    FEATURE_CHANNELS;
    channel += 1
  ) {
    const value =
      bias[channel] ??
      0;

    const start =
      channel *
      FEATURE_TOKENS;

    const end =
      start +
      FEATURE_TOKENS;

    for (
      let index = start;
      index < end;
      index += 1
    ) {
      result[index] =
        (result[index] ??
          0) -
        value;
    }
  }

  return result;
};

const atMemoryResolution = (
  field:
    Float32Array,
): Float32Array => {
  if (
    field.length !==
    MASK_SIDE *
      MASK_SIDE
  ) {
    throw new Error(
      "EdgeTAM mask does not match the decoder resolution.",
    );
  }

  const result =
    new Float32Array(
      MEMORY_MASK_SIDE *
        MEMORY_MASK_SIDE,
    );

  const scale =
    MASK_SIDE /
    MEMORY_MASK_SIDE;

  const low =
    new Int32Array(
      MEMORY_MASK_SIDE,
    );

  const high =
    new Int32Array(
      MEMORY_MASK_SIDE,
    );

  const fraction =
    new Float32Array(
      MEMORY_MASK_SIDE,
    );

  for (
    let output = 0;
    output <
    MEMORY_MASK_SIDE;
    output += 1
  ) {
    const source =
      Math.max(
        0,
        scale *
          (output + 0.5) -
          0.5,
      );

    const floor =
      Math.floor(
        source,
      );

    low[output] =
      floor;

    high[output] =
      Math.min(
        floor + 1,
        MASK_SIDE - 1,
      );

    fraction[output] =
      source -
      floor;
  }

  for (
    let y = 0;
    y <
    MEMORY_MASK_SIDE;
    y += 1
  ) {
    const top =
      (low[y] ??
        0) *
      MASK_SIDE;

    const bottom =
      (high[y] ??
        0) *
      MASK_SIDE;

    const down =
      fraction[y] ??
      0;

    const into =
      y *
      MEMORY_MASK_SIDE;

    for (
      let x = 0;
      x <
      MEMORY_MASK_SIDE;
      x += 1
    ) {
      const left =
        low[x] ??
        0;

      const right =
        high[x] ??
        0;

      const across =
        fraction[x] ??
        0;

      const upperLeft =
        field[
          top +
            left
        ] ??
        0;

      const upper =
        upperLeft +
        (
          (field[
            top +
              right
          ] ??
            0) -
          upperLeft
        ) *
          across;

      const lowerLeft =
        field[
          bottom +
            left
        ] ??
        0;

      const lower =
        lowerLeft +
        (
          (field[
            bottom +
              right
          ] ??
            0) -
          lowerLeft
        ) *
          across;

      result[
        into +
          x
      ] =
        upper +
        (lower -
          upper) *
          down;
    }
  }

  return result;
};

const maskForMemory = (
  logits:
    Float32Array,
  fromPrompt: boolean,
  scale: number,
  bias: number,
): Float32Array => {
  const result =
    new Float32Array(
      logits.length,
    );

  for (
    let index = 0;
    index <
    logits.length;
    index += 1
  ) {
    const value =
      logits[index] ??
      0;

    const decided =
      fromPrompt
        ? value > 0
          ? 1
          : 0
        : 1 /
          (
            1 +
            Math.exp(
              -value,
            )
          );

    result[index] =
      decided *
        scale +
      bias;
  }

  return result;
};

const visionPositionEncoding =
  (): Float32Array => {
    const features =
      FEATURE_CHANNELS /
      2;

    const scale =
      2 *
      Math.PI;

    const frequencies =
      new Float32Array(
        features,
      );

    for (
      let index = 0;
      index <
      features;
      index += 1
    ) {
      frequencies[index] =
        10000 **
        (
          (
            2 *
            Math.floor(
              index /
                2,
            )
          ) /
          features
        );
    }

    const result =
      new Float32Array(
        FEATURE_TOKENS *
          FEATURE_CHANNELS,
      );

    for (
      let y = 0;
      y <
      FEATURE_SIDE;
      y += 1
    ) {
      const down =
        (
          (y + 1) /
          (
            FEATURE_SIDE +
            1e-6
          )
        ) *
        scale;

      for (
        let x = 0;
        x <
        FEATURE_SIDE;
        x += 1
      ) {
        const across =
          (
            (x + 1) /
            (
              FEATURE_SIDE +
              1e-6
            )
          ) *
          scale;

        const token =
          (
            y *
              FEATURE_SIDE +
            x
          ) *
          FEATURE_CHANNELS;

        for (
          let index = 0;
          index <
          features;
          index += 2
        ) {
          const first =
            frequencies[index] ??
            1;

          const second =
            frequencies[
              index + 1
            ] ??
            1;

          result[
            token +
              index
          ] =
            Math.sin(
              down /
                first,
            );

          result[
            token +
              index +
              1
          ] =
            Math.cos(
              down /
                second,
            );

          result[
            token +
              features +
              index
          ] =
            Math.sin(
              across /
                first,
            );

          result[
            token +
              features +
              index +
              1
          ] =
            Math.cos(
              across /
                second,
            );
        }
      }
    }

    return result;
  };

class EdgeMemoryBank {
  #anchor:
    MemoryEntry |
    undefined;

  #recent:
    MemoryEntry[] = [];

  #anchorPointer:
    Float32Array |
    undefined;

  #recentPointers:
    Float32Array[] = [];

  condition(
    anchor:
      MemoryEntry,
  ): void {
    this.#anchor =
      anchor;

    this.#recent = [];

    this.#anchorPointer =
      undefined;

    this.#recentPointers = [];
  }

  push(
    memory:
      MemoryEntry,
    pointer:
      Float32Array,
  ): void {
    this.#recent.push(
      memory,
    );

    while (
      this.#recent.length >
      RECENT_ENTRIES
    ) {
      this.#recent.shift();
    }

    if (
      this.#anchorPointer ===
      undefined
    ) {
      this.#anchorPointer =
        pointer;

      return;
    }

    this.#recentPointers.push(
      pointer,
    );

    while (
      this.#recentPointers.length >
      MAX_POINTERS - 1
    ) {
      this.#recentPointers.shift();
    }
  }

  rewind(): void {
    this.#recent = [];

    this.#anchorPointer =
      undefined;

    this.#recentPointers = [];
  }

  assemble(
    temporal:
      readonly number[],
  ): EdgeMemoryAssembly {
    const anchor =
      this.#anchor;

    if (
      anchor === undefined
    ) {
      throw new Error(
        "EdgeTAM memory has no conditioning frame.",
      );
    }

    requireLength(
      temporal,
      MEMORY_ENTRIES *
        MEMORY_DIMENSION,
      "temporal position table",
    );

    const memory =
      new Float32Array(
        MEMORY_TOKENS *
          MEMORY_DIMENSION,
      );

    const positions =
      new Float32Array(
        MEMORY_TOKENS *
          MEMORY_DIMENSION,
      );

    const keyMask =
      new Float32Array(
        MEMORY_TOKENS,
      ).fill(
        MASKED_KEY,
      );

    const held = [
      anchor,
      ...this.#recent.slice(
        -RECENT_ENTRIES,
      ),
    ];

    held.forEach(
      (
        entry,
        slot,
      ) => {
        const offset =
          slot *
          MEMORY_ENTRY_TOKENS *
          MEMORY_DIMENSION;

        memory.set(
          entry.features,
          offset,
        );

        const age =
          slot === 0
            ? MEMORY_ENTRIES - 1
            : held.length -
              slot -
              1;

        const temporalOffset =
          Math.min(
            age,
            MEMORY_ENTRIES - 1,
          ) *
          MEMORY_DIMENSION;

        for (
          let token = 0;
          token <
          MEMORY_ENTRY_TOKENS;
          token += 1
        ) {
          const into =
            offset +
            token *
              MEMORY_DIMENSION;

          for (
            let channel = 0;
            channel <
            MEMORY_DIMENSION;
            channel += 1
          ) {
            positions[
              into +
                channel
            ] =
              (entry.positions[
                token *
                  MEMORY_DIMENSION +
                  channel
              ] ??
                0) +
              (temporal[
                temporalOffset +
                  channel
              ] ??
                0);
          }
        }

        keyMask.fill(
          0,
          slot *
            MEMORY_ENTRY_TOKENS,
          (slot + 1) *
            MEMORY_ENTRY_TOKENS,
        );
      },
    );

    const pointers =
      this.#anchorPointer ===
      undefined
        ? []
        : [
            this.#anchorPointer,
            ...[
              ...this
                .#recentPointers,
            ].reverse(),
          ];

    pointers
      .slice(
        0,
        MAX_POINTERS,
      )
      .forEach(
        (
          pointer,
          index,
        ) => {
          const token =
            POINTER_START +
            index *
              POINTER_SPLITS;

          memory.set(
            pointer.subarray(
              0,
              POINTER_DIMENSION,
            ),
            token *
              MEMORY_DIMENSION,
          );

          keyMask.fill(
            0,
            token,
            token +
              POINTER_SPLITS,
          );
        },
      );

    return {
      memory,
      positions,
      keyMask,
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

    if (
      candidate.inputSize !==
      MEMORY_MASK_SIDE
    ) {
      throw new Error(
        `EdgeTAM adapter expects ${MEMORY_MASK_SIDE}px input, received ${candidate.inputSize}px.`,
      );
    }

    const parameters =
      await fetchParameters(
        candidate,
      );

    const noMemory =
      parameters.parameters
        .no_memory_embedding;

    const temporal =
      parameters.parameters
        .memory_temporal_positional_encoding;

    const noObjectPointer =
      Float32Array.from(
        parameters.parameters
          .no_object_pointer,
      );

    const memoryScale =
      parameters.constants
        .sigmoid_scale_for_mem_enc;

    const memoryBias =
      parameters.constants
        .sigmoid_bias_for_mem_enc;

    const roles = [
      "vision-encoder",
      "mask-decoder",
      "memory-attention",
      "memory-encoder",
      "tracked-mask-decoder",
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
        seedMaskDecoder:
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
        trackedMaskDecoder:
          await load(
            "tracked-mask-decoder",
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
        "tracked-mask-decoder":
          loaded[4],
      });

      throw error;
    }

    const bank =
      new EdgeMemoryBank();

    const visionPositions =
      visionPositionEncoding();

    const encode =
      async (
        frame: VideoFrame,
      ): Promise<EncodedFrame> => {
        const outputs =
          await sessions.visionEncoder.run({
            pixel_values:
              new ort.Tensor(
                "float32",
                frameToNchw(
                  frame,
                  candidate.inputSize,
                  IMAGENET_MEAN,
                  IMAGENET_STD,
                ),
                [
                  1,
                  3,
                  candidate.inputSize,
                  candidate.inputSize,
                ],
              ),
          });

        const top =
          requireTensor(
            outputs,
            "image_embeddings.2",
          );

        const rawTop =
          removeNoMemoryBias(
            floatData(
              top,
              "EdgeTAM image_embeddings.2",
            ),
            noMemory,
          );

        return {
          fine0:
            requireTensor(
              outputs,
              "image_embeddings.0",
            ),
          fine1:
            requireTensor(
              outputs,
              "image_embeddings.1",
            ),
          top,
          rawTop,
          tokens:
            channelsToTokens(
              rawTop,
              FEATURE_CHANNELS,
              FEATURE_TOKENS,
            ),
        };
      };

    const seedDecode =
      async (
        vision:
          EncodedFrame,
        prompt:
          VideoSegmentationPrompt,
      ): Promise<SelectedMask> => {
        const coordinates =
          new Float32Array(
            prompt.points.length *
              2,
          );

        const labels =
          new BigInt64Array(
            prompt.points.length,
          );

        prompt.points.forEach(
          (
            point,
            index,
          ) => {
            coordinates[
              index * 2
            ] =
              point.x *
              candidate.inputSize;

            coordinates[
              index * 2 +
                1
            ] =
              point.y *
              candidate.inputSize;

            labels[index] =
              BigInt(
                point.label,
              );
          },
        );

        return selectBestMask(
          await sessions.seedMaskDecoder.run({
            "image_embeddings.0":
              vision.fine0,
            "image_embeddings.1":
              vision.fine1,
            "image_embeddings.2":
              vision.top,
            input_points:
              new ort.Tensor(
                "float32",
                coordinates,
                [
                  1,
                  1,
                  prompt.points.length,
                  2,
                ],
              ),
            input_labels:
              new ort.Tensor(
                "int64",
                labels,
                [
                  1,
                  1,
                  prompt.points.length,
                ],
              ),
            input_boxes:
              new ort.Tensor(
                "float32",
                new Float32Array(
                  0,
                ),
                [
                  1,
                  0,
                  4,
                ],
              ),
          }),
          prompt.proposalIndex,
        );
      };

    const remember =
      async (
        vision:
          EncodedFrame,
        mask:
          Float32Array,
        fromPrompt: boolean,
      ): Promise<MemoryEntry> => {
        const memoryMask =
          maskForMemory(
            atMemoryResolution(
              mask,
            ),
            fromPrompt,
            memoryScale,
            memoryBias,
          );

        const outputs =
          await sessions.memoryEncoder.run({
            vision_features:
              new ort.Tensor(
                "float32",
                vision.rawTop,
                [
                  1,
                  FEATURE_CHANNELS,
                  FEATURE_SIDE,
                  FEATURE_SIDE,
                ],
              ),
            mask_for_memory:
              new ort.Tensor(
                "float32",
                memoryMask,
                [
                  1,
                  1,
                  MEMORY_MASK_SIDE,
                  MEMORY_MASK_SIDE,
                ],
              ),
          });

        const features =
          floatData(
            requireTensor(
              outputs,
              "memory_features",
            ),
            "EdgeTAM memory_features",
          ).slice();

        const positions =
          floatData(
            requireTensor(
              outputs,
              "memory_positions",
            ),
            "EdgeTAM memory_positions",
          ).slice();

        const expected =
          MEMORY_ENTRY_TOKENS *
          MEMORY_DIMENSION;

        if (
          features.length !==
            expected ||
          positions.length !==
            expected
        ) {
          throw new Error(
            "EdgeTAM memory encoder returned unexpected geometry.",
          );
        }

        return {
          features,
          positions,
        };
      };

    return {
      candidate,

      async seed(
        frame,
        prompt,
      ) {
        if (
          prompt.points.length ===
          0
        ) {
          throw new Error(
            "EdgeTAM seed requires at least one point.",
          );
        }

        const vision =
          await encode(
            frame,
          );

        const selected =
          await seedDecode(
            vision,
            prompt,
          );

        bank.condition(
          await remember(
            vision,
            selected.logits,
            true,
          ),
        );

        return {
          logits:
            selected.logits,
          width:
            MASK_SIDE,
          height:
            MASK_SIDE,
          iou:
            selected.iou,
          objectScore:
            selected.objectScore,
          alternatives:
            selected.alternatives.map(
              (alternative) => ({
                logits:
                  alternative.logits,
                width:
                  MASK_SIDE,
                height:
                  MASK_SIDE,
                iou:
                  alternative.iou,
                objectScore:
                  selected.objectScore,
              }),
            ),
        };
      },

      async track(
        frame,
      ) {
        const vision =
          await encode(
            frame,
          );

        const memory =
          bank.assemble(
            temporal,
          );

        const attention =
          await sessions.memoryAttention.run({
            vision_features:
              new ort.Tensor(
                "float32",
                vision.tokens,
                [
                  FEATURE_TOKENS,
                  1,
                  FEATURE_CHANNELS,
                ],
              ),
            vision_position_embeddings:
              new ort.Tensor(
                "float32",
                visionPositions,
                [
                  FEATURE_TOKENS,
                  1,
                  FEATURE_CHANNELS,
                ],
              ),
            memory:
              new ort.Tensor(
                "float32",
                memory.memory,
                [
                  MEMORY_TOKENS,
                  1,
                  MEMORY_DIMENSION,
                ],
              ),
            memory_position_embeddings:
              new ort.Tensor(
                "float32",
                memory.positions,
                [
                  MEMORY_TOKENS,
                  1,
                  MEMORY_DIMENSION,
                ],
              ),
            key_mask:
              new ort.Tensor(
                "float32",
                memory.keyMask,
                [
                  1,
                  1,
                  1,
                  MEMORY_TOKENS,
                ],
              ),
          });

        const conditioned =
          tokensToChannels(
            floatData(
              requireTensor(
                attention,
                "conditioned_features",
              ),
              "EdgeTAM conditioned_features",
            ),
            FEATURE_CHANNELS,
            FEATURE_TOKENS,
          );

        const decoded =
          selectTrackedMask(
            await sessions.trackedMaskDecoder.run({
              "image_embeddings.0":
                vision.fine0,
              "image_embeddings.1":
                vision.fine1,
              "image_embeddings.2":
                new ort.Tensor(
                  "float32",
                  conditioned,
                  [
                    1,
                    FEATURE_CHANNELS,
                    FEATURE_SIDE,
                    FEATURE_SIDE,
                  ],
                ),
            }),
          );

        const objectScore =
          decoded.selected
            .objectScore ??
          Number.NEGATIVE_INFINITY;

        const present =
          objectScore >
          0;

        const logits =
          present
            ? decoded.selected
                .logits
            : new Float32Array(
                MASK_SIDE *
                  MASK_SIDE,
              ).fill(
                NO_OBJECT_LOGIT,
              );

        bank.push(
          await remember(
            vision,
            logits,
            false,
          ),
          present
            ? decoded.pointer
            : noObjectPointer,
        );

        return {
          logits,
          width:
            MASK_SIDE,
          height:
            MASK_SIDE,
          iou:
            decoded.selected
              .iou,
          objectScore,
        };
      },

      rewind() {
        bank.rewind();
      },

      async close() {
        await closeVideoSessions({
          "vision-encoder":
            sessions.visionEncoder,
          "mask-decoder":
            sessions.seedMaskDecoder,
          "memory-attention":
            sessions.memoryAttention,
          "memory-encoder":
            sessions.memoryEncoder,
          "tracked-mask-decoder":
            sessions.trackedMaskDecoder,
        });
      },
    };
  };
