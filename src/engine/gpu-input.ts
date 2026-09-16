import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";
import { d, tgpu } from "typegpu";

import { InferenceFailed } from "./errors";
import type { GpuRuntime } from "./gpu";
import { MODEL_INPUT_SIZE, MODEL_PIXEL_COUNT } from "./image";
import type { RemovalTimingRecorder } from "./timing";

export type GpuModelInput = {
  readonly pixelBuffer: GPUBuffer;
  readonly tensorBuffer: GPUBuffer;
  readonly tensor: ort.Tensor;
};

const PIXEL_BUFFER_BYTES = MODEL_PIXEL_COUNT * 4;
const TENSOR_FLOAT_COUNT = MODEL_PIXEL_COUNT * 3;
const TENSOR_BUFFER_BYTES = TENSOR_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const NORMALIZE_WORKGROUP_SIZE = 256;
const NORMALIZE_WORKGROUP_COUNT = Math.ceil(MODEL_PIXEL_COUNT / NORMALIZE_WORKGROUP_SIZE);

const normalizeLayout = tgpu.bindGroupLayout({
  pixels: { storage: d.arrayOf(d.u32, MODEL_PIXEL_COUNT) },
  tensor: { storage: d.arrayOf(d.f32, TENSOR_FLOAT_COUNT), access: "mutable" },
});

const normalizeCompute = tgpu.computeFn({
  in: { gid: d.builtin.globalInvocationId },
  workgroupSize: [NORMALIZE_WORKGROUP_SIZE],
}) /* wgsl */ `{
  let pixel_index = in.gid.x;
  if (pixel_index >= pixel_count) {
    return;
  }

  let packed = pixels[pixel_index];
  let red = f32(packed & 255u) / 255.0;
  let green = f32((packed >> 8u) & 255u) / 255.0;
  let blue = f32((packed >> 16u) & 255u) / 255.0;

  tensor[pixel_index] = (red - 0.485) / 0.229;
  tensor[pixel_count + pixel_index] = (green - 0.456) / 0.224;
  tensor[(pixel_count * 2u) + pixel_index] = (blue - 0.406) / 0.225;
}`.$uses({
  pixel_count: d.u32(MODEL_PIXEL_COUNT),
  pixels: normalizeLayout.$.pixels,
  tensor: normalizeLayout.$.tensor,
});

type NormalizePipeline = ReturnType<GpuRuntime["root"]["createComputePipeline"]>;

type NormalizePipelineCache = {
  readonly device: GPUDevice;
  readonly pipeline: NormalizePipeline;
};

let cachedNormalizePipeline: NormalizePipelineCache | undefined;

const getNormalizePipeline = (runtime: GpuRuntime): NormalizePipeline => {
  if (cachedNormalizePipeline?.device === runtime.device) {
    return cachedNormalizePipeline.pipeline;
  }

  const pipeline = runtime.root.createComputePipeline({ compute: normalizeCompute });
  cachedNormalizePipeline = { device: runtime.device, pipeline };

  return pipeline;
};

export const createGpuModelInput = (
  runtime: GpuRuntime,
  pixels: Uint8ClampedArray,
  timings: RemovalTimingRecorder,
): Effect.Effect<GpuModelInput, InferenceFailed> =>
  Effect.try({
    try: () => {
      if (pixels.byteLength !== PIXEL_BUFFER_BYTES) {
        throw new Error(`Expected ${PIXEL_BUFFER_BYTES} RGBA bytes, received ${pixels.byteLength}.`);
      }

      const stopUpload = timings.begin("inputUploadMs");
      const pixelBuffer = runtime.device.createBuffer({
        mappedAtCreation: true,
        size: PIXEL_BUFFER_BYTES,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      });
      const tensorBuffer = runtime.device.createBuffer({
        size: TENSOR_BUFFER_BYTES,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      });

      try {
        new Uint8Array(pixelBuffer.getMappedRange()).set(pixels);
        pixelBuffer.unmap();

        const bindGroup = runtime.root.createBindGroup(normalizeLayout, {
          pixels: pixelBuffer,
          tensor: tensorBuffer,
        });
        getNormalizePipeline(runtime).with(bindGroup).dispatchWorkgroups(NORMALIZE_WORKGROUP_COUNT);
        stopUpload();

        const tensor = ort.Tensor.fromGpuBuffer(tensorBuffer, {
          dataType: "float32",
          dims: [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE],
        });

        return { pixelBuffer, tensorBuffer, tensor };
      } catch (error) {
        pixelBuffer.destroy();
        tensorBuffer.destroy();

        throw error;
      }
    },
    catch: (cause) =>
      new InferenceFailed({
        message: `TypeGPU could not normalize the resized image into the shared WebGPU input buffer. ${String(cause)}`,
      }),
  });

export const releaseGpuModelInput = (input: GpuModelInput): void => {
  input.tensor.dispose();
  input.pixelBuffer.destroy();
  input.tensorBuffer.destroy();
};
