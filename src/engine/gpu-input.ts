import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";
import { d, tgpu } from "typegpu";

import { InferenceFailed } from "./errors";
import type { GpuRuntime } from "./gpu";
import { MODEL_INPUT_SIZE } from "./image";
import type { RemovalTimingRecorder } from "./timing";

const MODEL_PIXEL_COUNT = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

const MODEL_INPUT_ELEMENT_COUNT = MODEL_PIXEL_COUNT * 3;

const FLOAT16_BYTE_LENGTH = 2;

const NORMALIZATION_WORKGROUP_SIZE = 16;

const NORMALIZATION_WORKGROUP_COUNT = MODEL_INPUT_SIZE / NORMALIZATION_WORKGROUP_SIZE;

const Fp32ModelInput = d.arrayOf(d.f32, MODEL_INPUT_ELEMENT_COUNT);

const Fp16ModelInput = d.arrayOf(d.f16, MODEL_INPUT_ELEMENT_COUNT);

const fp32ModelInputLayout = tgpu.bindGroupLayout({
  source: { texture: d.texture2d() },
  sampler: { sampler: "filtering" },
  output: { storage: Fp32ModelInput, access: "mutable" },
});

const fp16ModelInputLayout = tgpu.bindGroupLayout({
  source: { texture: d.texture2d() },
  sampler: { sampler: "filtering" },
  output: { storage: Fp16ModelInput, access: "mutable" },
});

const normalizeFp32ModelInput = tgpu
  .computeFn({
    in: { gid: d.builtin.globalInvocationId },
    workgroupSize: [NORMALIZATION_WORKGROUP_SIZE, NORMALIZATION_WORKGROUP_SIZE],
  })`{
    let x = in.gid.x;
    let y = in.gid.y;
    let pixelIndex = y * ${MODEL_INPUT_SIZE}u + x;
    let uv = (vec2f(f32(x), f32(y)) + vec2f(0.5, 0.5)) / ${MODEL_INPUT_SIZE}.0;
    let pixel = textureSampleLevel(layout.$.source, layout.$.sampler, uv, 0.0);

    layout.$.output[pixelIndex] = (pixel.x - 0.485) / 0.229;
    layout.$.output[${MODEL_PIXEL_COUNT}u + pixelIndex] = (pixel.y - 0.456) / 0.224;
    layout.$.output[${MODEL_PIXEL_COUNT * 2}u + pixelIndex] = (pixel.z - 0.406) / 0.225;
  }`
  .$uses({ layout: fp32ModelInputLayout });

const normalizeFp16ModelInput = tgpu
  .computeFn({
    in: { gid: d.builtin.globalInvocationId },
    workgroupSize: [NORMALIZATION_WORKGROUP_SIZE, NORMALIZATION_WORKGROUP_SIZE],
  })`{
    let x = in.gid.x;
    let y = in.gid.y;
    let pixelIndex = y * ${MODEL_INPUT_SIZE}u + x;
    let uv = (vec2f(f32(x), f32(y)) + vec2f(0.5, 0.5)) / ${MODEL_INPUT_SIZE}.0;
    let pixel = textureSampleLevel(layout.$.source, layout.$.sampler, uv, 0.0);

    layout.$.output[pixelIndex] = f16((pixel.x - 0.485) / 0.229);
    layout.$.output[${MODEL_PIXEL_COUNT}u + pixelIndex] = f16((pixel.y - 0.456) / 0.224);
    layout.$.output[${MODEL_PIXEL_COUNT * 2}u + pixelIndex] = f16((pixel.z - 0.406) / 0.225);
  }`
  .$uses({ layout: fp16ModelInputLayout });

export type ModelPrecision = "fp16" | "fp32";

export type GpuModelInput = {
  readonly buffer: GPUBuffer;
  readonly tensor: ort.Tensor;
  readonly releaseSourceTexture: () => void;
};

const createFp32NormalizationPipeline = (runtime: GpuRuntime) =>
  runtime.root.createComputePipeline({ compute: normalizeFp32ModelInput });

const createFp16NormalizationPipeline = (runtime: GpuRuntime) =>
  runtime.root.createComputePipeline({ compute: normalizeFp16ModelInput });

type Fp32NormalizationPipeline = ReturnType<typeof createFp32NormalizationPipeline>;

type Fp16NormalizationPipeline = ReturnType<typeof createFp16NormalizationPipeline>;

let cachedFp32NormalizationPipeline:
  | { readonly device: GPUDevice; readonly pipeline: Fp32NormalizationPipeline }
  | undefined;

let cachedFp16NormalizationPipeline:
  | { readonly device: GPUDevice; readonly pipeline: Fp16NormalizationPipeline }
  | undefined;

const getFp32NormalizationPipeline = (runtime: GpuRuntime): Fp32NormalizationPipeline => {
  if (cachedFp32NormalizationPipeline?.device === runtime.device) {
    return cachedFp32NormalizationPipeline.pipeline;
  }

  const pipeline = createFp32NormalizationPipeline(runtime);
  cachedFp32NormalizationPipeline = { device: runtime.device, pipeline };

  return pipeline;
};

const getFp16NormalizationPipeline = (runtime: GpuRuntime): Fp16NormalizationPipeline => {
  if (cachedFp16NormalizationPipeline?.device === runtime.device) {
    return cachedFp16NormalizationPipeline.pipeline;
  }

  const pipeline = createFp16NormalizationPipeline(runtime);
  cachedFp16NormalizationPipeline = { device: runtime.device, pipeline };

  return pipeline;
};

export const preferredModelPrecision = (runtime: GpuRuntime): ModelPrecision =>
  runtime.device.features.has("shader-f16") ? "fp16" : "fp32";

export const createGpuModelInput = (
  runtime: GpuRuntime,
  sourceBitmap: ImageBitmap,
  timings: RemovalTimingRecorder,
  precision: ModelPrecision,
): Effect.Effect<GpuModelInput, InferenceFailed> =>
  Effect.try({
    try: () => {
      if (precision === "fp16" && !runtime.device.features.has("shader-f16")) {
        throw new Error("The selected fp16 model requires the WebGPU shader-f16 feature.");
      }

      const stopGpuPrep = timings.begin("inputUploadMs");

      const sourceTexture = runtime.root
        .createTexture({
          size: [sourceBitmap.width, sourceBitmap.height],
          format: "rgba8unorm",
        })
        .$usage("sampled", "render");

      const sourceSampler = runtime.root.createSampler({
        magFilter: "linear",
        minFilter: "linear",
      });

      const modelInputByteLength =
        MODEL_INPUT_ELEMENT_COUNT * (precision === "fp16" ? FLOAT16_BYTE_LENGTH : Float32Array.BYTES_PER_ELEMENT);

      const buffer = runtime.device.createBuffer({
        size: modelInputByteLength,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      });

      try {
        sourceTexture.write(sourceBitmap);

        const sourceView = sourceTexture.createView(d.texture2d());

        if (precision === "fp16") {
          const outputBuffer = runtime.root.createBuffer(Fp16ModelInput, buffer).$usage("storage");
          const bindGroup = runtime.root.createBindGroup(fp16ModelInputLayout, {
            source: sourceView,
            sampler: sourceSampler,
            output: outputBuffer,
          });

          getFp16NormalizationPipeline(runtime)
            .with(bindGroup)
            .dispatchWorkgroups(NORMALIZATION_WORKGROUP_COUNT, NORMALIZATION_WORKGROUP_COUNT);
        } else {
          const outputBuffer = runtime.root.createBuffer(Fp32ModelInput, buffer).$usage("storage");
          const bindGroup = runtime.root.createBindGroup(fp32ModelInputLayout, {
            source: sourceView,
            sampler: sourceSampler,
            output: outputBuffer,
          });

          getFp32NormalizationPipeline(runtime)
            .with(bindGroup)
            .dispatchWorkgroups(NORMALIZATION_WORKGROUP_COUNT, NORMALIZATION_WORKGROUP_COUNT);
        }

        stopGpuPrep();

        const tensor = ort.Tensor.fromGpuBuffer(buffer, {
          dataType: precision === "fp16" ? "float16" : "float32",
          dims: [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE],
        });

        return {
          buffer,
          tensor,
          releaseSourceTexture: () => sourceTexture.destroy(),
        };
      } catch (error) {
        sourceTexture.destroy();
        buffer.destroy();

        throw error;
      }
    },
    catch: (cause) =>
      new InferenceFailed({
        message: `TypeGPU could not resize and normalize the image into the shared ${precision} ONNX Runtime input buffer. ${String(cause)}`,
      }),
  });

export const releaseGpuModelInput = (input: GpuModelInput): void => {
  input.tensor.dispose();
  input.releaseSourceTexture();
  input.buffer.destroy();
};
