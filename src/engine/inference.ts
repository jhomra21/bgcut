import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import {
  ExportFailed,
  ImageProcessingFailed,
  InferenceFailed,
  ModelDownloadFailed,
  ModelLoadFailed,
  type BackgroundRemovalError,
} from "./errors";
import { float16ViewToFloat32Array } from "./float16";
import type { GpuRuntime } from "./gpu";
import {
  createGpuModelInput,
  preferredModelPrecision,
  releaseGpuModelInput,
  type ModelPrecision,
} from "./gpu-input";
import { MODEL_INPUT_SIZE, loadImageBitmap } from "./image";
import { logitToAlphaByte } from "./matte";
import { getGpuRuntime } from "./runtime";
import {
  createRemovalTimingRecorder,
  type RemovalTimingRecorder,
  type RemovalTimings,
} from "./timing";

export const MODEL_REVISION = "4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7";

const MODEL_FILES: Readonly<Record<ModelPrecision, string>> = {
  fp16: "model_fp16.onnx",
  fp32: "model.onnx",
};

const modelUrl = (precision: ModelPrecision): string =>
  `https://huggingface.co/studioludens/birefnet-lite-512/resolve/${MODEL_REVISION}/onnx/${MODEL_FILES[precision]}`;

export type BackgroundRemovalResult = {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly modelRevision: string;
  readonly modelPrecision: ModelPrecision;
  readonly timings: RemovalTimings;
};

type SessionCache = {
  readonly device: GPUDevice;
  readonly precision: ModelPrecision;
  readonly session: ort.InferenceSession;
};

let cachedSession: SessionCache | undefined;

const fetchModel = (precision: ModelPrecision): Effect.Effect<Uint8Array, ModelDownloadFailed> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(modelUrl(precision), { cache: "force-cache" }),
      catch: () =>
        new ModelDownloadFailed({
          message: `BiRefNet ${precision} could not be downloaded. Check the network connection and try again.`,
        }),
    });

    if (!response.ok) {
      return yield* new ModelDownloadFailed({
        message: `BiRefNet ${precision} download failed with HTTP ${response.status}.`,
      });
    }

    const bytes = yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: () =>
        new ModelDownloadFailed({
          message: `The BiRefNet ${precision} model response could not be read.`,
        }),
    });

    return new Uint8Array(bytes);
  });

const createSession = (
  runtime: GpuRuntime,
  precision: ModelPrecision,
  timings: RemovalTimingRecorder,
): Effect.Effect<ort.InferenceSession, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    const stopModelDownload = timings.begin("modelDownloadMs");
    const model = yield* fetchModel(precision);
    stopModelDownload();

    const stopSessionInit = timings.begin("sessionInitMs");

    const session = yield* Effect.tryPromise({
      try: () =>
        ort.InferenceSession.create(model, {
          executionProviders: [{ name: "webgpu", device: runtime.device }],
          graphOptimizationLevel: "all",
          preferredOutputLocation: "gpu-buffer",
        }),
      catch: (cause) =>
        new ModelLoadFailed({
          message: `BiRefNet ${precision} downloaded, but ONNX Runtime could not create the WebGPU session. ${String(cause)}`,
        }),
    });

    stopSessionInit();

    return session;
  });

const getSession = (
  runtime: GpuRuntime,
  precision: ModelPrecision,
  timings: RemovalTimingRecorder,
): Effect.Effect<ort.InferenceSession, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    if (cachedSession?.device === runtime.device && cachedSession.precision === precision) {
      timings.markSessionReused();

      return cachedSession.session;
    }

    cachedSession = undefined;
    const session = yield* createSession(runtime, precision, timings);
    cachedSession = { device: runtime.device, precision, session };

    return session;
  });

const runModel = (
  session: ort.InferenceSession,
  runtime: GpuRuntime,
  sourceBitmap: ImageBitmap,
  precision: ModelPrecision,
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

    return yield* Effect.acquireUseRelease(
      createGpuModelInput(runtime, sourceBitmap, timings, precision),
      (input) =>
        Effect.gen(function* () {
          const stopInference = timings.begin("inferenceMs");

          const outputs = yield* Effect.tryPromise({
            try: () => session.run({ [inputName]: input.tensor }),
            catch: (cause) =>
              new InferenceFailed({
                message: `BiRefNet ${precision} inference failed on the WebGPU device. ${String(cause)}`,
              }),
          });

          stopInference();

          const output = outputs[outputName];

          if (output === undefined) {
            return yield* new InferenceFailed({
              message: "BiRefNet completed without returning its foreground matte.",
            });
          }

          return yield* Effect.acquireUseRelease(
            Effect.succeed(output),
            (tensor) =>
              Effect.gen(function* () {
                if (tensor.location !== "gpu-buffer") {
                  return yield* new InferenceFailed({
                    message: `BiRefNet returned its matte at ${tensor.location} instead of the requested WebGPU buffer.`,
                  });
                }

                const stopReadback = timings.begin("outputReadbackMs");

                const outputData = yield* Effect.tryPromise({
                  try: () => tensor.getData(),
                  catch: () =>
                    new InferenceFailed({
                      message: "BiRefNet returned a GPU matte that could not be read back to the CPU.",
                    }),
                });

                stopReadback();

                let logits: Float32Array | undefined;

                if (tensor.type === "float32" && outputData instanceof Float32Array) {
                  logits = outputData.slice();
                } else if (tensor.type === "float16" && ArrayBuffer.isView(outputData)) {
                  logits = float16ViewToFloat32Array(outputData);
                }

                if (logits === undefined) {
                  return yield* new InferenceFailed({
                    message: `BiRefNet ${precision} returned unexpected ${tensor.type} output data.`,
                  });
                }

                if (logits.length !== MODEL_INPUT_SIZE * MODEL_INPUT_SIZE) {
                  return yield* new InferenceFailed({
                    message: "BiRefNet returned a matte with unexpected dimensions.",
                  });
                }

                return logits;
              }),
            (tensor) => Effect.sync(() => tensor.dispose()),
          );
        }),
      (input) => Effect.sync(() => releaseGpuModelInput(input)),
    );
  });

const createMatteCanvas = (logits: Float32Array): Effect.Effect<HTMLCanvasElement, ImageProcessingFailed> =>
  Effect.try({
    try: () => {
      const canvas = document.createElement("canvas");
      canvas.width = MODEL_INPUT_SIZE;
      canvas.height = MODEL_INPUT_SIZE;

      const context = canvas.getContext("2d");

      if (context === null) {
        throw new Error("2D canvas is unavailable.");
      }

      const matte = context.createImageData(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

      for (let pixelIndex = 0; pixelIndex < logits.length; pixelIndex += 1) {
        const alpha = logitToAlphaByte(logits[pixelIndex]);
        const rgbaIndex = pixelIndex * 4;
        matte.data[rgbaIndex] = 255;
        matte.data[rgbaIndex + 1] = 255;
        matte.data[rgbaIndex + 2] = 255;
        matte.data[rgbaIndex + 3] = alpha;
      }

      context.putImageData(matte, 0, 0);

      return canvas;
    },
    catch: () =>
      new ImageProcessingFailed({
        message: "The foreground matte could not be converted into an image mask.",
      }),
  });

const canvasToPng = (canvas: HTMLCanvasElement): Effect.Effect<Blob, ExportFailed> =>
  Effect.tryPromise({
    try: () =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) {
            reject(new Error("PNG encoding returned no blob."));

            return;
          }

          resolve(blob);
        }, "image/png");
      }),
    catch: () =>
      new ExportFailed({
        message: "The transparent image could not be encoded as PNG.",
      }),
  });

const createSourceComposite = (
  bitmap: ImageBitmap,
  matte: HTMLCanvasElement,
): Effect.Effect<HTMLCanvasElement, ImageProcessingFailed> =>
  Effect.try({
    try: () => {
      const output = document.createElement("canvas");
      output.width = bitmap.width;
      output.height = bitmap.height;

      const context = output.getContext("2d");

      if (context === null) {
        throw new Error("2D canvas is unavailable.");
      }

      context.drawImage(bitmap, 0, 0);
      context.globalCompositeOperation = "destination-in";
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(matte, 0, 0, bitmap.width, bitmap.height);
      context.globalCompositeOperation = "source-over";

      return output;
    },
    catch: () =>
      new ImageProcessingFailed({
        message: "The foreground matte could not be applied at the source image resolution.",
      }),
  });

export const removeBackground = (
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

          const precision = preferredModelPrecision(runtime);
          const session = yield* getSession(runtime, precision, timings);
          const logits = yield* runModel(session, runtime, bitmap, precision, timings);

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
            modelPrecision: precision,
            timings: timings.finish(),
          };
        }),
      (bitmap) => Effect.sync(() => bitmap.close()),
    );
  });
