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
import type { GpuRuntime } from "./gpu";
import { createGpuModelInput, releaseGpuModelInput } from "./gpu-input";
import { MODEL_INPUT_SIZE, loadImageBitmap, prepareModelInput } from "./image";
import { logitToAlphaByte } from "./matte";
import { getGpuRuntime } from "./runtime";
import {
  createRemovalTimingRecorder,
  type RemovalTimingRecorder,
  type RemovalTimings,
} from "./timing";

export const MODEL_REVISION = "4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7";

const MODEL_URL = `https://huggingface.co/studioludens/birefnet-lite-512/resolve/${MODEL_REVISION}/onnx/model.onnx`;

export type BackgroundRemovalResult = {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly modelRevision: string;
  readonly timings: RemovalTimings;
};

type SessionCache = {
  readonly device: GPUDevice;
  readonly session: ort.InferenceSession;
};

let cachedSession: SessionCache | undefined;

const fetchModel = (): Effect.Effect<Uint8Array, ModelDownloadFailed> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(MODEL_URL, { cache: "force-cache" }),
      catch: () =>
        new ModelDownloadFailed({
          message: "BiRefNet could not be downloaded. Check the network connection and try again.",
        }),
    });

    if (!response.ok) {
      return yield* new ModelDownloadFailed({
        message: `BiRefNet download failed with HTTP ${response.status}.`,
      });
    }

    const bytes = yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: () =>
        new ModelDownloadFailed({
          message: "The BiRefNet model response could not be read.",
        }),
    });

    return new Uint8Array(bytes);
  });

const createSession = (
  timings: RemovalTimingRecorder,
): Effect.Effect<ort.InferenceSession, ModelDownloadFailed | ModelLoadFailed> =>
  Effect.gen(function* () {
    const stopModelDownload = timings.begin("modelDownloadMs");
    const model = yield* fetchModel();
    stopModelDownload();

    const stopSessionInit = timings.begin("sessionInitMs");

    const session = yield* Effect.tryPromise({
      try: () =>
        ort.InferenceSession.create(model, {
          executionProviders: ["webgpu"],
          graphOptimizationLevel: "all",
          preferredOutputLocation: "gpu-buffer",
        }),
      catch: () =>
        new ModelLoadFailed({
          message: "BiRefNet downloaded, but ONNX Runtime could not create the WebGPU session.",
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
    const session = yield* createSession(timings);
    cachedSession = { device: runtime.device, session };

    return session;
  });

const runModel = (
  session: ort.InferenceSession,
  runtime: GpuRuntime,
  modelInput: Float32Array,
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
      createGpuModelInput(runtime.device, modelInput, timings),
      (input) =>
        Effect.gen(function* () {
          const stopInference = timings.begin("inferenceMs");

          const outputs = yield* Effect.tryPromise({
            try: () => session.run({ [inputName]: input.tensor }),
            catch: (cause) =>
              new InferenceFailed({
                message: `BiRefNet inference failed on the WebGPU device. ${String(cause)}`,
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

                if (!(outputData instanceof Float32Array)) {
                  return yield* new InferenceFailed({
                    message: "The fp32 BiRefNet model returned an unexpected output type.",
                  });
                }

                if (outputData.length !== MODEL_INPUT_SIZE * MODEL_INPUT_SIZE) {
                  return yield* new InferenceFailed({
                    message: "BiRefNet returned a matte with unexpected dimensions.",
                  });
                }

                return outputData.slice();
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

          const session = yield* getSession(runtime, timings);

          const stopPreprocess = timings.begin("preprocessMs");
          const modelInput = yield* prepareModelInput(bitmap);
          stopPreprocess();

          const logits = yield* runModel(session, runtime, modelInput, timings);

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
            timings: timings.finish(),
          };
        }),
      (bitmap) => Effect.sync(() => bitmap.close()),
    );
  });
