import { Effect } from "effect";
import * as ort from "onnxruntime-web/wasm";
import {
  ImageProcessingFailed,
  InferenceFailed,
  ModelDownloadFailed,
  ModelLoadFailed,
  type BackgroundRemovalError,
} from "./errors";
import { loadImageBitmap } from "./image";
import { MODEL_INPUT_SIZE, MODEL_REVISION } from "../shared/model";
import { canvasToPng, createMatteCanvas, createSourceComposite } from "./image-output";
import type { BackgroundRemovalResult } from "./inference";
import { fetchModelBytes } from "./model-loader";
import { resolveOrtWasmModuleUrl, resolveOrtWasmUrl } from "../shared/runtime-assets";
import { normalizeRgbaToNchw } from "../shared/preprocess";
import {
  createRemovalTimingRecorder,
  type RemovalTimingRecorder,
} from "./timing";

let wasmConfigured = false;

let cachedSession: ort.InferenceSession | undefined;

const configureWasmRuntime = (): void => {
  if (wasmConfigured) {
    return;
  }

  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? 0 : 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = {
    mjs: resolveOrtWasmModuleUrl(globalThis.location.href),
    wasm: resolveOrtWasmUrl(globalThis.location.href),
  };
  wasmConfigured = true;
};

const getSession = (
  timings: RemovalTimingRecorder,
): Effect.Effect<ort.InferenceSession, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    if (cachedSession !== undefined) {
      timings.markSessionReused();

      return cachedSession;
    }

    const stopModelDownload = timings.begin("modelDownloadMs");
    const model = yield* fetchModelBytes();
    stopModelDownload();

    const stopSessionInit = timings.begin("sessionInitMs");

    const session = yield* Effect.tryPromise({
      try: () =>
        ort.InferenceSession.create(model, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        }),
      catch: (cause) =>
        new ModelLoadFailed({
          message: `The optimized BiRefNet graph downloaded, but ONNX Runtime could not create the WebAssembly session. ${String(cause)}`,
        }),
    });

    stopSessionInit();
    cachedSession = session;

    return session;
  });

const createModelInput = (
  bitmap: ImageBitmap,
  timings: RemovalTimingRecorder,
): Effect.Effect<ort.Tensor, ImageProcessingFailed> =>
  Effect.try({
    try: () => {
      const stopPreprocess = timings.begin("preprocessMs");
      const canvas = document.createElement("canvas");
      canvas.width = MODEL_INPUT_SIZE;
      canvas.height = MODEL_INPUT_SIZE;

      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (context === null) {
        throw new Error("2D canvas is unavailable.");
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

      const pixels = context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;
      const input = normalizeRgbaToNchw(pixels, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
      stopPreprocess();

      return new ort.Tensor("float32", input, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
    },
    catch: () =>
      new ImageProcessingFailed({
        message: "The source image could not be resized and normalized for WebAssembly inference.",
      }),
  });

const runModel = (
  session: ort.InferenceSession,
  input: ort.Tensor,
  timings: RemovalTimingRecorder,
): Effect.Effect<Float32Array, InferenceFailed> =>
  Effect.gen(function* () {
    const inputName = session.inputNames.at(0);
    const outputName = session.outputNames.at(0);

    if (inputName === undefined || outputName === undefined) {
      return yield* new InferenceFailed({
        message: "BiRefNet does not expose the expected input and output tensors.",
      });
    }

    const stopInference = timings.begin("inferenceMs");

    const outputs = yield* Effect.tryPromise({
      try: () => session.run({ [inputName]: input }),
      catch: (cause) =>
        new InferenceFailed({
          message: `Optimized BiRefNet inference failed in the WebAssembly fallback. ${String(cause)}`,
        }),
    });

    stopInference();

    const output = outputs[outputName];

    if (output === undefined) {
      return yield* new InferenceFailed({
        message: "BiRefNet completed without returning its foreground matte.",
      });
    }

    if (!(output.data instanceof Float32Array)) {
      return yield* new InferenceFailed({
        message: `BiRefNet returned ${output.type} data instead of float32 logits in the WebAssembly fallback.`,
      });
    }

    if (output.data.length !== MODEL_INPUT_SIZE * MODEL_INPUT_SIZE) {
      return yield* new InferenceFailed({
        message: "BiRefNet returned a WebAssembly matte with unexpected dimensions.",
      });
    }

    return output.data;
  });

export const removeBackgroundWasm = (
  file: File,
): Effect.Effect<BackgroundRemovalResult, BackgroundRemovalError> =>
  Effect.suspend(() => {
    const timings = createRemovalTimingRecorder();

    return Effect.acquireUseRelease(
      Effect.gen(function* () {
        const stopDecode = timings.begin("decodeMs");
        const bitmap = yield* loadImageBitmap(file);
        stopDecode();

        return bitmap;
      }),
      (bitmap) =>
        Effect.gen(function* () {
          const stopRuntime = timings.begin("runtimeMs");
          configureWasmRuntime();
          stopRuntime();

          const session = yield* getSession(timings);
          const input = yield* createModelInput(bitmap, timings);
          const logits = yield* runModel(session, input, timings);

          const stopMatte = timings.begin("matteMs");
          const matte = yield* createMatteCanvas(logits);
          stopMatte();

          const stopComposite = timings.begin("compositeMs");
          const output = yield* createSourceComposite(bitmap, matte);
          stopComposite();

          const stopExport = timings.begin("exportMs");
          const blob = yield* canvasToPng(output);
          stopExport();

          return {
            blob,
            width: bitmap.width,
            height: bitmap.height,
            modelRevision: MODEL_REVISION,
            engine: "wasm" as const,
            timings: timings.finish(),
          };
        }),
      (bitmap) => Effect.sync(() => bitmap.close()),
    );
  });
