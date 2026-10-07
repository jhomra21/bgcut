import { Schema } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import { resolveOrtWebGpuWasmUrl } from "../../../src/browser/ort-webgpu-runtime";

import {
  browserVideoModelUrl,
} from "./model-delivery";

import type {
  VideoModelArtifact,
  VideoModelGraphRole,
  VideoSegmentationCandidate,
} from "./types";

const ModelConstantsSchema = Schema.Struct({
  image_mean:
    Schema.optional(
      Schema.Array(
        Schema.Number,
      ),
    ),
  image_std:
    Schema.optional(
      Schema.Array(
        Schema.Number,
      ),
    ),
  memory_temporal_positional_encoding:
    Schema.Array(
      Schema.Array(
        Schema.Number,
      ),
    ),
  no_memory_embedding:
    Schema.optional(
      Schema.Array(
        Schema.Number,
      ),
    ),
});

export type VideoModelConstants = {
  readonly image_mean:
    readonly [
      number,
      number,
      number,
    ];
  readonly image_std:
    readonly [
      number,
      number,
      number,
    ];
  readonly memory_temporal_positional_encoding:
    readonly (
      readonly number[]
    )[];
  readonly no_memory_embedding?:
    readonly number[];
};

export type VideoSessionMap =
  Partial<
    Record<
      VideoModelGraphRole,
      ort.InferenceSession
    >
  >;

export type VideoPointPromptTensors = {
  readonly points: ort.Tensor;
  readonly labels: ort.Tensor;
};

const requireThreeChannels = (
  values: readonly number[],
  label: string,
): readonly [
  number,
  number,
  number,
] => {
  if (values.length !== 3) {
    throw new Error(
      `${label} must contain three channels.`,
    );
  }

  return [
    values[0] ?? 0,
    values[1] ?? 0,
    values[2] ?? 0,
  ];
};

export const configureVideoOrt = (): void => {
  ort.env.wasm.wasmPaths = {
    wasm: resolveOrtWebGpuWasmUrl(
      globalThis.location.href,
    ),
  };

  ort.env.webgpu.powerPreference =
    "high-performance";
};

export const artifactFor = (
  candidate: VideoSegmentationCandidate,
  role:
    VideoModelArtifact["role"],
): VideoModelArtifact => {
  const artifact =
    candidate.artifacts.find(
      (entry) =>
        entry.role === role,
    );

  if (artifact === undefined) {
    throw new Error(
      `${candidate.label} has no ${role} artifact.`,
    );
  }

  return artifact;
};

export const fetchVideoModelConstants =
  async (
    candidate: VideoSegmentationCandidate,
  ): Promise<VideoModelConstants> => {
    const artifact =
      artifactFor(
        candidate,
        "constants",
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
        `Could not fetch ${candidate.label} constants: HTTP ${response.status}.`,
      );
    }

    const decoded =
      Schema.decodeUnknownSync(
        ModelConstantsSchema,
      )(
        await response.json(),
      );

    return {
      ...decoded,
      image_mean:
        requireThreeChannels(
          decoded.image_mean ?? [
            0.485,
            0.456,
            0.406,
          ],
          "image_mean",
        ),
      image_std:
        requireThreeChannels(
          decoded.image_std ?? [
            0.229,
            0.224,
            0.225,
          ],
          "image_std",
        ),
    };
  };

export const createVideoSession =
  async (
    candidate: VideoSegmentationCandidate,
    role: VideoModelGraphRole,
    preferredOutputLocation?:
      ort.InferenceSession.SessionOptions[
        "preferredOutputLocation"
      ],
  ): Promise<ort.InferenceSession> => {
    const artifact =
      artifactFor(
        candidate,
        role,
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
        `Could not fetch ${candidate.label} ${role}: HTTP ${response.status}.`,
      );
    }

    const externalData:
      {
        readonly path: string;
        readonly data:
          Uint8Array<ArrayBuffer>;
      }[] = [];

    for (
      const external of
      artifact.externalData ??
      []
    ) {
      const externalResponse =
        await fetch(
          browserVideoModelUrl(
            external.url,
          ),
          {
            cache:
              "force-cache",
          },
        );

      if (
        !externalResponse.ok
      ) {
        throw new Error(
          `Could not fetch ${candidate.label} ${external.filename}: HTTP ${externalResponse.status}.`,
        );
      }

      externalData.push({
        path:
          external.filename,
        data:
          new Uint8Array(
            await externalResponse.arrayBuffer(),
          ),
      });
    }

    const sessionOptions:
      ort.InferenceSession.SessionOptions = {
        executionProviders: [
          {
            name: "webgpu",
          },
        ],
        graphOptimizationLevel:
          "all",
      };

    if (
      preferredOutputLocation !==
      undefined
    ) {
      sessionOptions.preferredOutputLocation =
        preferredOutputLocation;
    }

    if (
      externalData.length >
      0
    ) {
      sessionOptions.externalData =
        externalData;
    }

    return ort.InferenceSession.create(
      new Uint8Array(
        await response.arrayBuffer(),
      ),
      sessionOptions,
    );
  };

export const closeVideoSessions =
  async (
    sessions: VideoSessionMap,
  ): Promise<void> => {
    await Promise.all(
      Object.values(
        sessions,
      ).map(
        async (session) => {
          try {
            await session?.release();
          } catch {
            // Benchmark cleanup must not hide the result that preceded it.
          }
        },
      ),
    );
  };

export const frameToNchw =
  (
    frame: VideoFrame,
    imageSize: number,
    mean: readonly number[],
    std: readonly number[],
  ): Float32Array => {
    const canvas =
      new OffscreenCanvas(
        imageSize,
        imageSize,
      );

    const context =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        },
      );

    if (context === null) {
      throw new Error(
        "Could not create the video benchmark 2D canvas.",
      );
    }

    context.drawImage(
      frame,
      0,
      0,
      imageSize,
      imageSize,
    );

    const image =
      context.getImageData(
        0,
        0,
        imageSize,
        imageSize,
      );

    const channelPixels =
      imageSize *
      imageSize;

    const result =
      new Float32Array(
        channelPixels *
          3,
      );

    for (
      let pixel = 0;
      pixel <
      channelPixels;
      pixel += 1
    ) {
      const source =
        pixel * 4;

      for (
        let channel = 0;
        channel < 3;
        channel += 1
      ) {
        const channelMean =
          mean[channel] ??
          0;

        const channelStd =
          std[channel] ??
          1;

        if (
          channelStd === 0
        ) {
          throw new Error(
            `image_std[${channel}] must be non-zero.`,
          );
        }

        const value =
          (image.data[
            source +
              channel
          ] ??
            0) /
          255;

        result[
          channel *
            channelPixels +
            pixel
        ] =
          (value -
            channelMean) /
          channelStd;
      }
    }

    return result;
  };

export const floatData = (
  tensor: ort.Tensor,
  label: string,
): Float32Array => {
  if (
    !(
      tensor.data instanceof
      Float32Array
    )
  ) {
    throw new Error(
      `${label} is not a float32 tensor.`,
    );
  }

  return tensor.data;
};

export const addChannelBias = (
  channels: Float32Array,
  channelCount: number,
  bias: readonly number[],
): Float32Array => {
  if (
    bias.length !==
      channelCount ||
    channels.length %
      channelCount !==
      0
  ) {
    throw new Error(
      "Channel bias geometry does not match the feature tensor.",
    );
  }

  const pixelsPerChannel =
    channels.length /
    channelCount;

  const result =
    channels.slice();

  for (
    let channel = 0;
    channel <
    channelCount;
    channel += 1
  ) {
    const value =
      bias[channel] ??
      0;

    const start =
      channel *
      pixelsPerChannel;

    const end =
      start +
      pixelsPerChannel;

    for (
      let index = start;
      index < end;
      index += 1
    ) {
      result[index] =
        (result[index] ??
          0) +
        value;
    }
  }

  return result;
};

export const channelsToTokens = (
  channels: Float32Array,
  channelCount: number,
  tokenCount: number,
): Float32Array => {
  if (
    channels.length !==
    channelCount *
      tokenCount
  ) {
    throw new Error(
      "Feature tensor does not match the requested token geometry.",
    );
  }

  const tokens =
    new Float32Array(
      channels.length,
    );

  for (
    let channel = 0;
    channel <
    channelCount;
    channel += 1
  ) {
    for (
      let token = 0;
      token <
      tokenCount;
      token += 1
    ) {
      tokens[
        token *
          channelCount +
          channel
      ] =
        channels[
          channel *
            tokenCount +
            token
        ] ??
        0;
    }
  }

  return tokens;
};

export const tokensToChannels = (
  tokens: Float32Array,
  channelCount: number,
  tokenCount: number,
): Float32Array => {
  if (
    tokens.length !==
    channelCount *
      tokenCount
  ) {
    throw new Error(
      "Token tensor does not match the requested feature geometry.",
    );
  }

  const channels =
    new Float32Array(
      tokens.length,
    );

  for (
    let token = 0;
    token <
    tokenCount;
    token += 1
  ) {
    for (
      let channel = 0;
      channel <
      channelCount;
      channel += 1
    ) {
      channels[
        channel *
          tokenCount +
          token
      ] =
        tokens[
          token *
            channelCount +
            channel
        ] ??
        0;
    }
  }

  return channels;
};

export const temporalPositions = (
  spatial: Float32Array,
  row: readonly number[],
  memoryDimension = 64,
): Float32Array => {
  if (
    spatial.length %
      memoryDimension !==
    0 ||
    row.length !==
      memoryDimension
  ) {
    throw new Error(
      "Temporal memory position geometry does not match.",
    );
  }

  const result =
    new Float32Array(
      spatial.length,
    );

  for (
    let index = 0;
    index <
    spatial.length;
    index += 1
  ) {
    result[index] =
      (spatial[index] ??
        0) +
      (row[
        index %
          memoryDimension
      ] ??
        0);
  }

  return result;
};

export const concatenateFloat32 = (
  arrays:
    readonly Float32Array[],
): Float32Array => {
  const length =
    arrays.reduce(
      (sum, array) =>
        sum +
        array.length,
      0,
    );

  const result =
    new Float32Array(
      length,
    );

  let offset = 0;

  for (
    const array of
    arrays
  ) {
    result.set(
      array,
      offset,
    );

    offset +=
      array.length;
  }

  return result;
};

export const pointPromptTensors = (
  points:
    readonly {
      readonly x: number;
      readonly y: number;
      readonly label:
        | -1
        | 0
        | 1;
    }[],
  imageSize: number,
): VideoPointPromptTensors => {
  const pointValues =
    new Float32Array(
      points.length *
        2,
    );

  const labels =
    new Int32Array(
      points.length,
    );

  points.forEach(
    (point, index) => {
      pointValues[
        index * 2
      ] =
        point.x *
        imageSize;

      pointValues[
        index * 2 +
          1
      ] =
        point.y *
        imageSize;

      labels[index] =
        point.label;
    },
  );

  return {
    points:
      new ort.Tensor(
        "float32",
        pointValues,
        [
          1,
          1,
          points.length,
          2,
        ],
      ),
    labels:
      new ort.Tensor(
        "int32",
        labels,
        [
          1,
          1,
          points.length,
        ],
      ),
  };
};
