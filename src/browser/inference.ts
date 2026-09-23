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
import { loadImageBitmap, MODEL_INPUT_SIZE } from "./image";
import { canvasToPng, createMatteCanvas, createSourceComposite } from "./image-output";
import { fetchModelBytes } from "./model-loader";
import { MODEL_REVISION } from "../shared/model-config";
import { resolveOrtWebGpuWasmUrl } from "./ort-webgpu-runtime";
import { getGpuRuntime } from "./runtime";
import {
  createRemovalTimingRecorder,
  type RemovalTimingRecorder,
  type RemovalTimings,
} from "./timing";

export { MODEL_REVISION };

export type BrowserInferenceEngine = "webgpu" | "wasm";

export type WebGpuOutputLocation = "gpu-buffer" | "cpu";

export type WebGpuDiagnosticStage =
  | "session-ready"
  | "inference-start"
  | "inference-complete"
  | "matte-complete"
  | "composite-complete"
  | "export-complete";

export type WebGpuDiagnosticObserver = (
  stage: WebGpuDiagnosticStage,
) => void;

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
  readonly outputLocation: WebGpuOutputLocation;
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
  outputLocation: WebGpuOutputLocation,
): Effect.Effect<ort.InferenceSession, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    const stopModelDownload = timings.begin("modelDownloadMs");
    const model = yield* fetchModelBytes();
    stopModelDownload();

    configureOrtWebGpuRuntime();

    const stopSessionInit = timings.begin("sessionInitMs");

    const session = yield* Effect.tryPromise({
      try: () =>
        ort.InferenceSession.create(model, {
          executionProviders: [{ name: "webgpu", device: runtime.device }],
          enableGraphCapture: graphCapture,
          graphOptimizationLevel: "all",
          preferredOutputLocation: outputLocation,
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
  outputLocation: WebGpuOutputLocation,
): Effect.Effect<SessionLease, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    if (strategy === "capture-recreate") {
      yield* clearCachedSession();

      return {
        session: yield* createSession(
          runtime,
          timings,
          true,
          "gpu-buffer",
        ),
        releaseAfterUse: true,
      };
    }

    const graphCapture = strategy === "capture-reuse";

    if (
      cachedSession?.device === runtime.device &&
      cachedSession.graphCapture === graphCapture &&
      cachedSession.outputLocation === outputLocation
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
      outputLocation,
    );

    cachedSession = {
      device: runtime.device,
      graphCapture,
      outputLocation,
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
  outputLocation: WebGpuOutputLocation,
  diagnosticObserver?: WebGpuDiagnosticObserver,
): Effect.Effect<Float32Array, InferenceFailed> =>
  Effect.gen(function* () {
    const inputName = session.inputNames.at(0);
    const outputName = session.outputNames.at(0);

    if (inputName === undefined || outputName === undefined) {
      return yield* new InferenceFailed({
        message: "BiRefNet does not expose the expected input and output tensors.",
      });
    }

    const outputTarget =
      outputLocation === "gpu-buffer"
        ? getGpuModelOutput(runtime)
        : undefined;

    return yield* Effect.acquireUseRelease(
      createGpuModelInput(runtime, sourceBitmap, timings),
      (input) =>
        Effect.gen(function* () {
          diagnosticObserver?.("inference-start");

          const stopInference = timings.begin("inferenceMs");

          const outputs = yield* Effect.tryPromise({
            try: () =>
              outputTarget === undefined
                ? session.run({
                    [inputName]: input.tensor,
                  })
                : session.run(
                    { [inputName]: input.tensor },
                    {
                      [outputName]:
                        outputTarget.tensor,
                    },
                  ),
            catch: (cause) =>
              new InferenceFailed({
                message: graphCapture
                  ? `Optimized BiRefNet graph-capture inference failed on the WebGPU device. ${String(cause)}`
                  : `Optimized BiRefNet inference failed on the WebGPU device. ${String(cause)}`,
              }),
          });

          stopInference();
          diagnosticObserver?.("inference-complete");

          const output = outputs[outputName];

          if (output === undefined) {
            return yield* new InferenceFailed({
              message: "BiRefNet completed without returning its foreground matte.",
            });
          }

          if (outputLocation === "gpu-buffer") {
            if (
              output.location !== "gpu-buffer" ||
              outputTarget === undefined
            ) {
              return yield* new InferenceFailed({
                message: `BiRefNet returned its matte at ${output.location} instead of the persistent WebGPU output buffer.`,
              });
            }

            return yield* readGpuModelOutput(
              runtime,
              outputTarget,
              timings,
            );
          }

          if (output.location !== "cpu") {
            return yield* new InferenceFailed({
              message: `BiRefNet returned its matte at ${output.location} instead of CPU memory.`,
            });
          }

          const data = output.data;

          if (
            !(data instanceof Float32Array) ||
            data.length !==
              MODEL_INPUT_SIZE * MODEL_INPUT_SIZE
          ) {
            return yield* new InferenceFailed({
              message: "BiRefNet returned a CPU matte with unexpected data or dimensions.",
            });
          }

          return data;
        }),
      (input) => Effect.sync(() => releaseGpuModelInput(input)),
    );
  });

export const removeBackgroundWebGpuWithStrategy = (
  file: File,
  strategy: WebGpuSessionStrategy,
  outputLocation: WebGpuOutputLocation = "gpu-buffer",
  diagnosticObserver?: WebGpuDiagnosticObserver,
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
              outputLocation,
            ),
            (lease) =>
              Effect.gen(function* () {
                diagnosticObserver?.("session-ready");

                const logits = yield* runModel(
                  lease.session,
                  runtime,
                  bitmap,
                  timings,
                  strategy !== "no-capture-reuse",
                  outputLocation,
                  diagnosticObserver,
                );

                const stopMatte = timings.begin("matteMs");
                const matte = yield* createMatteCanvas(logits);
                stopMatte();
                diagnosticObserver?.("matte-complete");

                const stopComposite = timings.begin("compositeMs");
                const output = yield* createSourceComposite(bitmap, matte);
                stopComposite();
                diagnosticObserver?.("composite-complete");

                const stopExport = timings.begin("exportMs");
                const blob = yield* canvasToPng(output);
                stopExport();
                diagnosticObserver?.("export-complete");

                return {
                  blob,
                  width: bitmap.width,
                  height: bitmap.height,
                  modelRevision: MODEL_REVISION,
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
