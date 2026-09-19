import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";
import { d, tgpu } from "typegpu";

import { InferenceFailed } from "./errors";
import type { GpuRuntime } from "./gpu";
import { MODEL_INPUT_SIZE } from "../shared/model";
import type { RemovalTimingRecorder } from "./timing";

const MODEL_PIXEL_COUNT = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

const MODEL_INPUT_ELEMENT_COUNT = MODEL_PIXEL_COUNT * 3;

const MODEL_INPUT_BYTE_LENGTH = MODEL_INPUT_ELEMENT_COUNT * Float32Array.BYTES_PER_ELEMENT;

const NORMALIZATION_WORKGROUP_SIZE = 16;

const NORMALIZATION_WORKGROUP_COUNT = MODEL_INPUT_SIZE / NORMALIZATION_WORKGROUP_SIZE;

const ModelInput = d.arrayOf(d.f32, MODEL_INPUT_ELEMENT_COUNT);

const modelInputLayout = tgpu.bindGroupLayout({
  source: { texture: d.texture2d() },
  sampler: { sampler: "filtering" },
  output: { storage: ModelInput, access: "mutable" },
});

const normalizeModelInput = tgpu
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
  .$uses({ layout: modelInputLayout });

export type GpuModelInput = {
  readonly buffer: GPUBuffer;
  readonly tensor: ort.Tensor;
  readonly releaseSourceTexture: () => void;
};

type PersistentModelInput = {
  readonly device: GPUDevice;
  readonly buffer: GPUBuffer;
  readonly tensor: ort.Tensor;
};

const createNormalizationPipeline = (runtime: GpuRuntime) =>
  runtime.root.createComputePipeline({ compute: normalizeModelInput });

type NormalizationPipeline = ReturnType<typeof createNormalizationPipeline>;

let cachedNormalizationPipeline:
  | { readonly device: GPUDevice; readonly pipeline: NormalizationPipeline }
  | undefined;

let persistentModelInput: PersistentModelInput | undefined;

const getNormalizationPipeline = (runtime: GpuRuntime): NormalizationPipeline => {
  if (cachedNormalizationPipeline?.device === runtime.device) {
    return cachedNormalizationPipeline.pipeline;
  }

  const pipeline = createNormalizationPipeline(runtime);
  cachedNormalizationPipeline = { device: runtime.device, pipeline };

  return pipeline;
};

const releasePersistentModelInput = (): void => {
  if (persistentModelInput === undefined) {
    return;
  }

  persistentModelInput.tensor.dispose();
  persistentModelInput.buffer.destroy();
  persistentModelInput = undefined;
};

const getPersistentModelInput = (runtime: GpuRuntime): PersistentModelInput => {
  if (persistentModelInput?.device === runtime.device) {
    return persistentModelInput;
  }

  releasePersistentModelInput();

  const buffer = runtime.device.createBuffer({
    size: MODEL_INPUT_BYTE_LENGTH,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
  });

  const tensor = ort.Tensor.fromGpuBuffer(buffer, {
    dataType: "float32",
    dims: [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE],
  });

  persistentModelInput = {
    device: runtime.device,
    buffer,
    tensor,
  };

  return persistentModelInput;
};

export const createGpuModelInput = (
  runtime: GpuRuntime,
  sourceBitmap: ImageBitmap,
  timings: RemovalTimingRecorder,
): Effect.Effect<GpuModelInput, InferenceFailed> =>
  Effect.try({
    try: () => {
      const stopGpuPrep = timings.begin("inputUploadMs");
      const modelInput = getPersistentModelInput(runtime);

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

      try {
        sourceTexture.write(sourceBitmap);

        const sourceView = sourceTexture.createView(d.texture2d());

        const outputBuffer = runtime.root.createBuffer(ModelInput, modelInput.buffer).$usage("storage");

        const bindGroup = runtime.root.createBindGroup(modelInputLayout, {
          source: sourceView,
          sampler: sourceSampler,
          output: outputBuffer,
        });

        getNormalizationPipeline(runtime)
          .with(bindGroup)
          .dispatchWorkgroups(NORMALIZATION_WORKGROUP_COUNT, NORMALIZATION_WORKGROUP_COUNT);
        stopGpuPrep();

        return {
          buffer: modelInput.buffer,
          tensor: modelInput.tensor,
          releaseSourceTexture: () => sourceTexture.destroy(),
        };
      } catch (error) {
        sourceTexture.destroy();

        throw error;
      }
    },
    catch: (cause) =>
      new InferenceFailed({
        message: `TypeGPU could not resize and normalize the image into the persistent ONNX Runtime input buffer. ${String(cause)}`,
      }),
  });

export const releaseGpuModelInput = (input: GpuModelInput): void => {
  input.releaseSourceTexture();
};
