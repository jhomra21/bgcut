import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import { resolveBrowserEnginePreference } from "./engine-preference";
import {
  resolveDefaultWebGpuSessionStrategy,
  type WebGpuSessionStrategy,
} from "./webgpu-session-strategy";
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
import {
  MODEL_PUBLIC_PATH,
  MODEL_REVISION,
  WEBGPU_MODEL_PUBLIC_PATH,
  WEBGPU_MODEL_REVISION,
} from "../shared/model-config";
import { resolveOrtWebGpuWasmUrl } from "./ort-webgpu-runtime";
import { getGpuRuntime } from "./runtime";
import {
  createRemovalTimingRecorder,
  type RemovalTimingRecorder,
  type RemovalTimings,
} from "./timing";

export { MODEL_REVISION, WEBGPU_MODEL_REVISION };

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
  readonly graphCapture: boolean;
  readonly modelPath: string;
  readonly session: ort.InferenceSession;
};

type SessionLease = {
  readonly session: ort.InferenceSession;
  readonly releaseAfterUse: boolean;
};

let cachedSession: SessionCache | undefined;

let ortWebGpuRuntimeConfigured = false;

const configureOrtWebGpuRuntime = (): void => {
  if (ortWebGpuRuntimeConfigured) {
    return;
  }

  ort.env.wasm.wasmPaths = {
    wasm: resolveOrtWebGpuWasmUrl(globalThis.location.href),
  };

  ortWebGpuRuntimeConfigured = true;
};

const createSession = (
  runtime: GpuRuntime,
  timings: RemovalTimingRecorder,
  graphCapture: boolean,
  modelPath: string,
): Effect.Effect<ort.InferenceSession, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    const stopModelDownload = timings.begin("modelDownloadMs");

    const model = yield* fetchModelBytes(
      modelPath,
    );

    stopModelDownload();

    configureOrtWebGpuRuntime();

    const stopSessionInit = timings.begin("sessionInitMs");

    const session = yield* Effect.tryPromise({
      try: () =>
        ort.InferenceSession.create(model, {
          executionProviders: [{ name: "webgpu", device: runtime.device }],
          enableGraphCapture: graphCapture,
          graphOptimizationLevel: "all",
          preferredOutputLocation: "gpu-buffer",
        }),
      catch: (cause) =>
        new ModelLoadFailed({
          message: graphCapture
            ? `The optimized BiRefNet graph downloaded, but ONNX Runtime could not create the WebGPU graph-capture session. ${String(cause)}`
            : `The optimized BiRefNet graph downloaded, but ONNX Runtime could not create the WebGPU session. ${String(cause)}`,
        }),
    });

    stopSessionInit();

    return session;
  });

const releaseSessionSilently = (
  session: ort.InferenceSession,
): Effect.Effect<void> =>
  Effect.tryPromise(() => session.release()).pipe(
    Effect.catchAll(() => Effect.void),
  );

const clearCachedSession = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (cachedSession === undefined) {
      return;
    }

    const session = cachedSession.session;
    cachedSession = undefined;

    yield* releaseSessionSilently(session);
  });

const getSessionLease = (
  runtime: GpuRuntime,
  timings: RemovalTimingRecorder,
  strategy: WebGpuSessionStrategy,
  modelPath: string,
): Effect.Effect<SessionLease, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    if (strategy === "capture-recreate") {
      yield* clearCachedSession();

      return {
        session: yield* createSession(
          runtime,
          timings,
          true,
          modelPath,
        ),
        releaseAfterUse: true,
      };
    }

    const graphCapture = strategy === "capture-reuse";

    if (
      cachedSession?.device === runtime.device &&
      cachedSession.graphCapture === graphCapture &&
      cachedSession.modelPath === modelPath
    ) {
      timings.markSessionReused();

      return {
        session: cachedSession.session,
        releaseAfterUse: false,
      };
    }

    yield* clearCachedSession();

    const session = yield* createSession(
      runtime,
      timings,
      graphCapture,
      modelPath,
    );

    cachedSession = {
      device: runtime.device,
      graphCapture,
      modelPath,
      session,
    };

    return {
      session,
      releaseAfterUse: false,
    };
  });

const releaseSessionLease = (
  lease: SessionLease,
): Effect.Effect<void> =>
  lease.releaseAfterUse
    ? releaseSessionSilently(lease.session)
    : Effect.void;

const runModel = (
  session: ort.InferenceSession,
  runtime: GpuRuntime,
  sourceBitmap: ImageBitmap,
  timings: RemovalTimingRecorder,
  graphCapture: boolean,
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
                message: graphCapture
                  ? `Optimized BiRefNet graph-capture inference failed on the WebGPU device. ${String(cause)}`
                  : `Optimized BiRefNet inference failed on the WebGPU device. ${String(cause)}`,
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

export const removeBackgroundWebGpuWithStrategy = (
  file: File,
  strategy: WebGpuSessionStrategy,
  modelPath: string = WEBGPU_MODEL_PUBLIC_PATH,
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

          return yield* Effect.acquireUseRelease(
            getSessionLease(
              runtime,
              timings,
              strategy,
              modelPath,
            ),
            (lease) =>
              Effect.gen(function* () {
                const logits = yield* runModel(
                  lease.session,
                  runtime,
                  bitmap,
                  timings,
                  strategy !== "no-capture-reuse",
                );

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
                  modelRevision:
                    modelPath === WEBGPU_MODEL_PUBLIC_PATH
                      ? WEBGPU_MODEL_REVISION
                      : MODEL_REVISION,
                  engine: "webgpu" as const,
                  timings: timings.finish(),
                };
              }),
            releaseSessionLease,
          );
        }),
      (bitmap) => Effect.sync(() => bitmap.close()),
    );
  });

export const removeBackgroundWebGpu = (
  file: File,
): Effect.Effect<BackgroundRemovalResult, BackgroundRemovalError> =>
  removeBackgroundWebGpuWithStrategy(
    file,
    resolveDefaultWebGpuSessionStrategy(
      typeof globalThis.navigator === "undefined"
        ? ""
        : globalThis.navigator.userAgent,
    ),
  );

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
