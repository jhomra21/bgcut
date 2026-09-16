import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import { InferenceFailed } from "./errors";
import { MODEL_INPUT_SIZE } from "./image";
import type { RemovalTimingRecorder } from "./timing";

export type GpuModelInput = {
  readonly tensor: ort.Tensor;
};

export const createGpuModelInput = (
  _device: GPUDevice,
  modelInput: Float32Array,
  timings: RemovalTimingRecorder,
): Effect.Effect<GpuModelInput, InferenceFailed> =>
  Effect.try({
    try: () => {
      const stopStaging = timings.begin("inputUploadMs");

      const tensor = new ort.Tensor("float32", modelInput, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
      stopStaging();

      return { tensor };
    },
    catch: (cause) =>
      new InferenceFailed({
        message: `The preprocessed image could not be wrapped in the CPU-backed ONNX input tensor. ${String(cause)}`,
      }),
  });

export const releaseGpuModelInput = (input: GpuModelInput): void => {
  input.tensor.dispose();
};
