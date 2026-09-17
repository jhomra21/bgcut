import { Data, Effect } from "effect";
import * as ort from "onnxruntime-node";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

import { MODEL_INPUT_SIZE } from "../engine/image";
import { logitToAlphaByte } from "../engine/matte";
import { normalizeRgbaToNchw } from "../engine/preprocess";
import type { CliEngine, CliFormat, CliOptions } from "./args";
import { CliModelError, ensureCliModel } from "./model-cache";

export type CliExecutionEngine = "webgpu" | "cpu";

export type CliTimings = {
  readonly totalMs: number;
  readonly modelMs: number;
  readonly prepareMs: number;
  readonly sessionMs: number;
  readonly inferenceMs: number;
  readonly encodeMs: number;
};

export type CliRemovalResult = {
  readonly width: number;
  readonly height: number;
  readonly outputPath: string;
  readonly engine: CliExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly timings: CliTimings;
};

export class CliImageError extends Data.TaggedError("CliImageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CliSessionError extends Data.TaggedError("CliSessionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CliInferenceError extends Data.TaggedError("CliInferenceError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CliOutputError extends Data.TaggedError("CliOutputError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type PreparedImage = {
  readonly source: Buffer;
  readonly width: number;
  readonly height: number;
  readonly modelInput: Float32Array;
};

type NativeSession = {
  readonly session: ort.InferenceSession;
  readonly engine: CliExecutionEngine;
  readonly fallbackReason: string | undefined;
};

const supportedSharpFormats = new Set(["jpeg", "png", "webp"]);

const prepareImage = (inputPath: string): Effect.Effect<PreparedImage, CliImageError> =>
  Effect.tryPromise({
    try: async () => {
      const input = Bun.file(inputPath);

      if (!(await input.exists())) {
        throw new Error(`Input file does not exist: ${inputPath}`);
      }

      const metadata = await sharp(inputPath).metadata();

      if (metadata.format === undefined || !supportedSharpFormats.has(metadata.format)) {
        throw new Error(`Unsupported image type: ${metadata.format ?? "unknown"}`);
      }

      const source = await sharp(inputPath)
        .rotate()
        .ensureAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });

      const model = await sharp(inputPath)
        .rotate()
        .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, {
          fit: "fill",
          kernel: sharp.kernel.cubic,
          fastShrinkOnLoad: false,
        })
        .ensureAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (source.info.channels !== 4 || model.info.channels !== 4) {
        throw new Error("Decoded image did not produce RGBA pixels.");
      }

      return {
        source: source.data,
        width: source.info.width,
        height: source.info.height,
        modelInput: normalizeRgbaToNchw(model.data, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
      };
    },
    catch: (cause) =>
      new CliImageError({
        message: `Could not decode and prepare ${inputPath}.`,
        cause,
      }),
  });

const createSessionForProvider = (
  modelPath: string,
  engine: CliExecutionEngine,
): Effect.Effect<NativeSession, CliSessionError> =>
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
      new CliSessionError({
        message: `ONNX Runtime could not create the native ${engine} session.`,
        cause,
      }),
  });

const createSession = (
  modelPath: string,
  engine: CliEngine,
): Effect.Effect<NativeSession, CliSessionError> => {
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
): Effect.Effect<Float32Array, CliInferenceError> =>
  Effect.gen(function* () {
    const inputName = session.inputNames.at(0);
    const outputName = session.outputNames.at(0);

    if (inputName === undefined || outputName === undefined) {
      return yield* new CliInferenceError({
        message: "BiRefNet does not expose the expected input and output tensors.",
      });
    }

    const input = new ort.Tensor("float32", modelInput, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

    const outputs = yield* Effect.tryPromise({
      try: () => session.run({ [inputName]: input }),
      catch: (cause) => new CliInferenceError({ message: "BiRefNet inference failed.", cause }),
    });

    const output = outputs[outputName];

    if (output === undefined) {
      return yield* new CliInferenceError({ message: "BiRefNet returned no foreground matte." });
    }

    const data = output.data;

    if (!(data instanceof Float32Array)) {
      return yield* new CliInferenceError({
        message: `BiRefNet returned ${output.type} data instead of float32 logits.`,
      });
    }

    if (data.length !== MODEL_INPUT_SIZE * MODEL_INPUT_SIZE) {
      return yield* new CliInferenceError({
        message: `BiRefNet returned ${data.length} logits instead of ${MODEL_INPUT_SIZE * MODEL_INPUT_SIZE}.`,
      });
    }

    return data;
  });

const createMask = (logits: Float32Array): Uint8Array => {
  const alpha = new Uint8Array(logits.length);

  for (let index = 0; index < logits.length; index += 1) {
    alpha[index] = logitToAlphaByte(logits[index]);
  }

  return alpha;
};

const encodeOutput = (
  prepared: PreparedImage,
  logits: Float32Array,
  outputPath: string,
  format: CliFormat,
): Effect.Effect<void, CliOutputError> =>
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
        .toBuffer();

      const rgba = Buffer.from(prepared.source);
      const pixelCount = prepared.width * prepared.height;

      for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
        const alphaIndex = pixelIndex * 4 + 3;

        rgba[alphaIndex] = Math.round((rgba[alphaIndex] * resizedAlpha[pixelIndex]) / 255);
      }

      await mkdir(dirname(outputPath), { recursive: true });

      const image = sharp(rgba, {
        raw: {
          width: prepared.width,
          height: prepared.height,
          channels: 4,
        },
      });

      if (format === "png") {
        await image.png().toFile(outputPath);

        return;
      }

      if (format === "webp") {
        await image.webp({ lossless: true }).toFile(outputPath);

        return;
      }

      await image
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toFile(outputPath);
    },
    catch: (cause) =>
      new CliOutputError({
        message: `Could not encode ${outputPath}.`,
        cause,
      }),
  });

export const removeBackgroundCli = (
  options: CliOptions,
): Effect.Effect<
  CliRemovalResult,
  CliImageError | CliSessionError | CliInferenceError | CliOutputError | CliModelError
> =>
  Effect.gen(function* () {
    if (resolve(options.inputPath) === resolve(options.outputPath)) {
      return yield* new CliOutputError({
        message: "Input and output paths must be different.",
      });
    }

    const totalStartedAt = performance.now();
    let stageStartedAt = performance.now();

    const modelPath = yield* ensureCliModel();
    const modelMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();

    const prepared = yield* prepareImage(options.inputPath);
    const prepareMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();

    const nativeSession = yield* createSession(modelPath, options.engine);
    const sessionMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();

    const logits = yield* Effect.acquireUseRelease(
      Effect.succeed(nativeSession.session),
      (session) => runInference(session, prepared.modelInput),
      (session) =>
        Effect.tryPromise({
          try: () => session.release(),
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => undefined)),
    );

    const inferenceMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();

    yield* encodeOutput(prepared, logits, options.outputPath, options.format);

    const encodeMs = performance.now() - stageStartedAt;
    const totalMs = performance.now() - totalStartedAt;

    return {
      width: prepared.width,
      height: prepared.height,
      outputPath: options.outputPath,
      engine: nativeSession.engine,
      fallbackReason: nativeSession.fallbackReason,
      timings: {
        totalMs,
        modelMs,
        prepareMs,
        sessionMs,
        inferenceMs,
        encodeMs,
      },
    };
  });
