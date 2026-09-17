import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import { resolveBrowserEnginePreference } from "./engine-preference";
import {
  InferenceFailed,
  ModelDownloadFailed,
  ModelLoadFailed,
  type BackgroundRemovalError,
} from "./errors";
import { shouldFallbackToWasm } from "./fallback-policy";
import type { GpuRuntime } from "./gpu";
import { createGpuModelInput, releaseGpuModelInput } from "./gpu-input";
import { getGpuModelOutput, readGpuModelOutput } from "./gpu-output";
import { loadImageBitmap } from "./image";
import { canvasToPng, createMatteCanvas, createSourceComposite } from "./image-output";
import { fetchModelBytes } from "./model-loader";
import { MODEL_REVISION } from "./model-config";
import { getGpuRuntime } from "./runtime";
import {
  createRemovalTimingRecorder,
  type RemovalTimingRecorder,
  type RemovalTimings,
} from "./timing";

export { MODEL_REVISION };

export type BrowserInferenceEngine = "webgpu" | "wasm";

export type BackgroundRemovalResult = {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly modelRevision: string;
  readonly engine: BrowserInferenceEngine;
  readonly timings: RemovalTimings;
};

type SessionCache = {
  readonly device: GPUDevice;
  readonly session: ort.InferenceSession;
};

let cachedSession: SessionCache | undefined;

const createSession = (
  runtime: GpuRuntime,
  timings: RemovalTimingRecorder,
): Effect.Effect<ort.InferenceSession, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    const stopModelDownload = timings.begin("modelDownloadMs");
    const model = yield* fetchModelBytes();
    stopModelDownload();

    const stopSessionInit = timings.begin("sessionInitMs");

    const session = yield* Effect.tryPromise({
      try: () =>
        ort.InferenceSession.create(model, {
          executionProviders: [{ name: "webgpu", device: runtime.device }],
          enableGraphCapture: true,
          graphOptimizationLevel: "all",
          preferredOutputLocation: "gpu-buffer",
        }),
      catch: (cause) =>
        new ModelLoadFailed({
          message: `The optimized BiRefNet graph downloaded, but ONNX Runtime could not create the WebGPU graph-capture session. ${String(cause)}`,
        }),
    });

    stopSessionInit();

    return session;
  });

const getSession = (
  runtime: GpuRuntime,
  timings: RemovalTimingRecorder,
): Effect.Effect<ort.InferenceSession, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    if (cachedSession?.device === runtime.device) {
      timings.markSessionReused();

      return cachedSession.session;
    }

    cachedSession = undefined;
    const session = yield* createSession(runtime, timings);
    cachedSession = { device: runtime.device, session };

    return session;
  });

const runModel = (
  session: ort.InferenceSession,
  runtime: GpuRuntime,
  sourceBitmap: ImageBitmap,
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

    const outputTarget = getGpuModelOutput(runtime);

    return yield* Effect.acquireUseRelease(
      createGpuModelInput(runtime, sourceBitmap, timings),
      (input) =>
        Effect.gen(function* () {
          const stopInference = timings.begin("inferenceMs");

          const outputs = yield* Effect.tryPromise({
            try: () =>
              session.run(
                { [inputName]: input.tensor },
                { [outputName]: outputTarget.tensor },
              ),
            catch: (cause) =>
              new InferenceFailed({
                message: `Optimized BiRefNet graph-capture inference failed on the WebGPU device. ${String(cause)}`,
              }),
          });

          stopInference();

          const output = outputs[outputName];

          if (output === undefined) {
            return yield* new InferenceFailed({
              message: "BiRefNet completed without returning its foreground matte.",
            });
          }

          if (output.location !== "gpu-buffer") {
            return yield* new InferenceFailed({
              message: `BiRefNet returned its matte at ${output.location} instead of the persistent WebGPU output buffer.`,
            });
          }

          return yield* readGpuModelOutput(runtime, outputTarget, timings);
        }),
      (input) => Effect.sync(() => releaseGpuModelInput(input)),
    );
  });

export const removeBackgroundWebGpu = (
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
          const runtime = yield* getGpuRuntime;
          stopRuntime();

          const session = yield* getSession(runtime, timings);
          const logits = yield* runModel(session, runtime, bitmap, timings);

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
            engine: "webgpu" as const,
            timings: timings.finish(),
          };
        }),
      (bitmap) => Effect.sync(() => bitmap.close()),
    );
  });

const removeBackgroundWithWasm = (
  file: File,
): Effect.Effect<BackgroundRemovalResult, BackgroundRemovalError> =>
  Effect.gen(function* () {
    const wasm = yield* Effect.tryPromise({
      try: () => import("./wasm-inference"),
      catch: (cause) =>
        new ModelLoadFailed({
          message: `The WebAssembly compatibility runtime could not be loaded. ${String(cause)}`,
        }),
    });

    return yield* wasm.removeBackgroundWasm(file);
  });

const automaticRemoval = (
  file: File,
): Effect.Effect<BackgroundRemovalResult, BackgroundRemovalError> =>
  removeBackgroundWebGpu(file).pipe(
    Effect.catchAll((error) =>
      shouldFallbackToWasm(error)
        ? removeBackgroundWithWasm(file)
        : Effect.fail(error)
    ),
  );

export const removeBackground = (
  file: File,
): Effect.Effect<BackgroundRemovalResult, BackgroundRemovalError> =>
  Effect.suspend(() => {
    const preference = resolveBrowserEnginePreference(
      typeof globalThis.location === "undefined" ? "" : globalThis.location.search,
    );

    if (preference === "webgpu") {
      return removeBackgroundWebGpu(file);
    }

    if (preference === "wasm") {
      return removeBackgroundWithWasm(file);
    }

    return automaticRemoval(file);
  });
