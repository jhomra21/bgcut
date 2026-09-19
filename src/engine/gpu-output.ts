import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import { InferenceFailed } from "./errors";
import type { GpuRuntime } from "./gpu";
import { MODEL_INPUT_SIZE } from "../shared/model-config";
import type { RemovalTimingRecorder } from "./timing";

const MODEL_OUTPUT_ELEMENT_COUNT = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

const MODEL_OUTPUT_BYTE_LENGTH = MODEL_OUTPUT_ELEMENT_COUNT * Float32Array.BYTES_PER_ELEMENT;

export type GpuModelOutput = {
  readonly buffer: GPUBuffer;
  readonly tensor: ort.Tensor;
};

type PersistentModelOutput = GpuModelOutput & {
  readonly device: GPUDevice;
};

let persistentModelOutput: PersistentModelOutput | undefined;

const releasePersistentModelOutput = (): void => {
  if (persistentModelOutput === undefined) {
    return;
  }

  persistentModelOutput.tensor.dispose();
  persistentModelOutput.buffer.destroy();
  persistentModelOutput = undefined;
};

export const getGpuModelOutput = (runtime: GpuRuntime): GpuModelOutput => {
  if (persistentModelOutput?.device === runtime.device) {
    return persistentModelOutput;
  }

  releasePersistentModelOutput();

  const buffer = runtime.device.createBuffer({
    size: MODEL_OUTPUT_BYTE_LENGTH,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
  });

  const tensor = ort.Tensor.fromGpuBuffer(buffer, {
    dataType: "float32",
    dims: [1, 1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE],
  });

  persistentModelOutput = {
    device: runtime.device,
    buffer,
    tensor,
  };

  return persistentModelOutput;
};

export const readGpuModelOutput = (
  runtime: GpuRuntime,
  output: GpuModelOutput,
  timings: RemovalTimingRecorder,
): Effect.Effect<Float32Array, InferenceFailed> =>
  Effect.gen(function* () {
    const stopReadback = timings.begin("outputReadbackMs");

    const data = yield* Effect.tryPromise({
      try: async () => {
        const stagingBuffer = runtime.device.createBuffer({
          size: MODEL_OUTPUT_BYTE_LENGTH,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        try {
          const encoder = runtime.device.createCommandEncoder();
          encoder.copyBufferToBuffer(output.buffer, 0, stagingBuffer, 0, MODEL_OUTPUT_BYTE_LENGTH);
          runtime.device.queue.submit([encoder.finish()]);

          await stagingBuffer.mapAsync(GPUMapMode.READ);

          return new Float32Array(stagingBuffer.getMappedRange().slice(0));
        } finally {
          if (stagingBuffer.mapState === "mapped") {
            stagingBuffer.unmap();
          }

          stagingBuffer.destroy();
        }
      },
      catch: () =>
        new InferenceFailed({
          message: "BiRefNet returned a GPU matte that could not be copied back to the CPU.",
        }),
    });

    stopReadback();

    if (data.length !== MODEL_OUTPUT_ELEMENT_COUNT) {
      return yield* new InferenceFailed({
        message: "BiRefNet returned a matte with unexpected dimensions.",
      });
    }

    return data;
  });
