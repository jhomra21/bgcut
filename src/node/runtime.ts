import { Data, Effect } from "effect";
import * as ort from "onnxruntime-node";
import { access } from "node:fs/promises";
import sharp from "sharp";

import { MODEL_INPUT_SIZE } from "../shared/model-config";
import { logitToAlphaByte } from "../shared/matte";
import { resizeRgbaLinearToNchw } from "../shared/preprocess";
import { compositeAlphaMask } from "../native/alpha-mask";
import { ModelCacheError, ensureCachedModel } from "../native/model-cache";

export type BgcutEngine = "auto" | "gpu" | "cpu";

export type BgcutExecutionEngine = "webgpu" | "cpu";

export type BgcutFormat = "png" | "webp" | "jpg";

export type BgcutInput = string | Uint8Array | ArrayBuffer;

export type BgcutSetupTimings = {
  readonly modelMs: number;
  readonly sessionMs: number;
};

export type BgcutRemovalTimings = {
  readonly totalMs: number;
  readonly prepareMs: number;
  readonly inferenceMs: number;
  readonly encodeMs: number;
};

export type BgcutRemovalResult = {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly format: BgcutFormat;
  readonly engine: BgcutExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly timings: BgcutRemovalTimings;
};

export class BgcutImageError extends Data.TaggedError("BgcutImageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class BgcutSessionError extends Data.TaggedError("BgcutSessionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class BgcutInferenceError extends Data.TaggedError("BgcutInferenceError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class BgcutOutputError extends Data.TaggedError("BgcutOutputError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type PreparedNativeImage = {
  readonly source: Buffer;
  readonly width: number;
  readonly height: number;
  readonly modelInput: Float32Array;
};

type NativeSession = {
  readonly session: ort.InferenceSession;
  readonly engine: BgcutExecutionEngine;
  readonly fallbackReason: string | undefined;
};

export type NativeBgcut = {
  readonly engine: BgcutExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly setupTimings: BgcutSetupTimings;
  readonly remove: (
    input: BgcutInput,
    format: BgcutFormat,
  ) => Effect.Effect<BgcutRemovalResult, BgcutImageError | BgcutInferenceError | BgcutOutputError>;
  readonly close: () => Effect.Effect<void>;
};

const toSharpInput = async (input: BgcutInput): Promise<string | Buffer> => {
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }

  await access(input);

  return input;
};

export const prepareNativeImage = (
  input: BgcutInput,
): Effect.Effect<PreparedNativeImage, BgcutImageError> =>
  Effect.tryPromise({
    try: async () => {
      const sharpInput = await toSharpInput(input);

      const source = await sharp(sharpInput)
        .rotate()
        .ensureAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (source.info.channels !== 4) {
        throw new Error("Decoded image did not produce RGBA pixels.");
      }

      return {
        source: source.data,
        width: source.info.width,
        height: source.info.height,
        modelInput: resizeRgbaLinearToNchw(
          source.data,
          source.info.width,
          source.info.height,
          MODEL_INPUT_SIZE,
          MODEL_INPUT_SIZE,
        ),
      };
    },
    catch: (cause) => {
      let message = "Could not decode and prepare the supplied image bytes.";

      if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
        message = `Could not decode and prepare ${input}.`;
      }

      return new BgcutImageError({
        message,
        cause,
      });
    },
  });

const createSessionForProvider = (
  modelPath: string,
  engine: BgcutExecutionEngine,
): Effect.Effect<NativeSession, BgcutSessionError> =>
  Effect.tryPromise({
    try: async () => ({
      session: await ort.InferenceSession.create(modelPath, {
        executionProviders: [engine],
        graphOptimizationLevel: "all",
      }),
      engine,
      fallbackReason: undefined,
    }),
    catch: (cause) =>
      new BgcutSessionError({
        message: `ONNX Runtime could not create the native ${engine} session.`,
        cause,
      }),
  });

const createSession = (
  modelPath: string,
  engine: BgcutEngine,
): Effect.Effect<NativeSession, BgcutSessionError> => {
  if (engine === "gpu") {
    return createSessionForProvider(modelPath, "webgpu");
  }

  if (engine === "cpu") {
    return createSessionForProvider(modelPath, "cpu");
  }

  return createSessionForProvider(modelPath, "webgpu").pipe(
    Effect.catchAll((webGpuError) =>
      createSessionForProvider(modelPath, "cpu").pipe(
        Effect.map((nativeSession) => ({
          ...nativeSession,
          fallbackReason: webGpuError.message,
        })),
      ),
    ),
  );
};

const runInference = (
  session: ort.InferenceSession,
  modelInput: Float32Array,
): Effect.Effect<Float32Array, BgcutInferenceError> =>
  Effect.gen(function* () {
    const inputName = session.inputNames.at(0);
    const outputName = session.outputNames.at(0);

    if (inputName === undefined || outputName === undefined) {
      return yield* new BgcutInferenceError({
        message: "BiRefNet does not expose the expected input and output tensors.",
      });
    }

    const tensor = new ort.Tensor("float32", modelInput, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

    const outputs = yield* Effect.tryPromise({
      try: () => session.run({ [inputName]: tensor }),
      catch: (cause) =>
        new BgcutInferenceError({
          message: "BiRefNet inference failed.",
          cause,
        }),
    });

    const output = outputs[outputName];

    if (output === undefined) {
      return yield* new BgcutInferenceError({
        message: "BiRefNet returned no foreground matte.",
      });
    }

    if (!(output.data instanceof Float32Array)) {
      return yield* new BgcutInferenceError({
        message: `BiRefNet returned ${output.type} data instead of float32 logits.`,
      });
    }

    if (output.data.length !== MODEL_INPUT_SIZE * MODEL_INPUT_SIZE) {
      return yield* new BgcutInferenceError({
        message: `BiRefNet returned ${output.data.length} logits instead of ${MODEL_INPUT_SIZE * MODEL_INPUT_SIZE}.`,
      });
    }

    return output.data;
  });

const createMask = (logits: Float32Array): Uint8Array => {
  const alpha = new Uint8Array(logits.length);

  for (let index = 0; index < logits.length; index += 1) {
    alpha[index] = logitToAlphaByte(logits[index]);
  }

  return alpha;
};

const encodeOutput = (
  prepared: PreparedNativeImage,
  logits: Float32Array,
  format: BgcutFormat,
): Effect.Effect<Buffer, BgcutOutputError> =>
  Effect.tryPromise({
    try: async () => {
      const alpha = createMask(logits);

      const resizedAlpha = await sharp(Buffer.from(alpha), {
        raw: {
          width: MODEL_INPUT_SIZE,
          height: MODEL_INPUT_SIZE,
          channels: 1,
        },
      })
        .resize(prepared.width, prepared.height, {
          fit: "fill",
          kernel: sharp.kernel.cubic,
          fastShrinkOnLoad: false,
        })
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (resizedAlpha.info.width !== prepared.width || resizedAlpha.info.height !== prepared.height) {
        throw new Error(
          `Resized matte is ${resizedAlpha.info.width} × ${resizedAlpha.info.height}; expected ${prepared.width} × ${prepared.height}.`,
        );
      }

      const rgba = Buffer.from(prepared.source);

      compositeAlphaMask(rgba, resizedAlpha.data, resizedAlpha.info.channels);

      const image = sharp(rgba, {
        raw: {
          width: prepared.width,
          height: prepared.height,
          channels: 4,
        },
      });

      if (format === "png") {
        return image.png().toBuffer();
      }

      if (format === "webp") {
        return image.webp({ lossless: true }).toBuffer();
      }

      return image
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer();
    },
    catch: (cause) =>
      new BgcutOutputError({
        message: `Could not encode the ${format.toUpperCase()} result.`,
        cause,
      }),
  });

export const createNativeBgcut = (
  engine: BgcutEngine = "auto",
): Effect.Effect<NativeBgcut, ModelCacheError | BgcutSessionError> =>
  Effect.gen(function* () {
    let stageStartedAt = performance.now();
    const modelPath = yield* ensureCachedModel();
    const modelMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();
    const nativeSession = yield* createSession(modelPath, engine);
    const sessionMs = performance.now() - stageStartedAt;

    let closed = false;

    return {
      engine: nativeSession.engine,
      fallbackReason: nativeSession.fallbackReason,
      setupTimings: {
        modelMs,
        sessionMs,
      },
      remove: (input, format) =>
        Effect.gen(function* () {
          if (closed) {
            return yield* new BgcutInferenceError({
              message: "This bgcut engine has already been closed.",
            });
          }

          const totalStartedAt = performance.now();
          let removalStageStartedAt = performance.now();

          const prepared = yield* prepareNativeImage(input);
          const prepareMs = performance.now() - removalStageStartedAt;

          removalStageStartedAt = performance.now();
          const logits = yield* runInference(nativeSession.session, prepared.modelInput);
          const inferenceMs = performance.now() - removalStageStartedAt;

          removalStageStartedAt = performance.now();
          const encoded = yield* encodeOutput(prepared, logits, format);
          const encodeMs = performance.now() - removalStageStartedAt;

          return {
            data: new Uint8Array(encoded),
            width: prepared.width,
            height: prepared.height,
            format,
            engine: nativeSession.engine,
            fallbackReason: nativeSession.fallbackReason,
            timings: {
              totalMs: performance.now() - totalStartedAt,
              prepareMs,
              inferenceMs,
              encodeMs,
            },
          };
        }),
      close: () =>
        Effect.tryPromise({
          try: async () => {
            if (closed) {
              return;
            }

            closed = true;
            await nativeSession.session.release();
          },
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => undefined)),
    };
  });
