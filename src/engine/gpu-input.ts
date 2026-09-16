import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import { InferenceFailed } from "./errors";
import { MODEL_INPUT_SIZE } from "./image";
import type { RemovalTimingRecorder } from "./timing";

export type GpuModelInput = {
  readonly buffer: GPUBuffer;
  readonly tensor: ort.Tensor;
};

const alignTo16Bytes = (byteLength: number): number => Math.ceil(byteLength / 16) * 16;

export const createGpuModelInput = (
  device: GPUDevice,
  modelInput: Float32Array,
  timings: RemovalTimingRecorder,
): Effect.Effect<GpuModelInput, InferenceFailed> =>
  Effect.tryPromise({
    try: async () => {
      const stopUpload = timings.begin("inputUploadMs");

      const buffer = device.createBuffer({
        size: alignTo16Bytes(modelInput.byteLength),
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      });

      try {
        device.queue.writeBuffer(buffer, 0, modelInput);
        await device.queue.onSubmittedWorkDone();
        stopUpload();

        const tensor = ort.Tensor.fromGpuBuffer(buffer, {
          dataType: "float32",
          dims: [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE],
        });

        return { buffer, tensor };
      } catch (error) {
        buffer.destroy();

        throw error;
      }
    },
    catch: () =>
      new InferenceFailed({
        message: "The preprocessed image could not be uploaded to the shared WebGPU device.",
      }),
  });

export const releaseGpuModelInput = (input: GpuModelInput): void => {
  input.tensor.dispose();
  input.buffer.destroy();
};
