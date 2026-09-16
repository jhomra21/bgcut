import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";
import { d, tgpu } from "typegpu";
import { textureLoad } from "typegpu/std";

import { InferenceFailed } from "./errors";
import type { GpuRuntime } from "./gpu";
import { MODEL_INPUT_SIZE } from "./image";
import type { RemovalTimingRecorder } from "./timing";

const MODEL_PIXEL_COUNT = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
const MODEL_INPUT_ELEMENT_COUNT = MODEL_PIXEL_COUNT * 3;
const MODEL_INPUT_BYTE_LENGTH = MODEL_INPUT_ELEMENT_COUNT * Float32Array.BYTES_PER_ELEMENT;

const ModelInput = d.arrayOf(d.f32, MODEL_INPUT_ELEMENT_COUNT);

const modelInputLayout = tgpu.bindGroupLayout({
  source: { texture: d.texture2d() },
  output: { storage: ModelInput, access: "mutable" },
});

export type GpuModelInput = {
  readonly buffer: GPUBuffer;
  readonly tensor: ort.Tensor;
  readonly releaseSourceTexture: () => void;
};

const createNormalizationPipeline = (runtime: GpuRuntime) =>
  runtime.root.createGuardedComputePipeline((x, y) => {
    "use gpu";

    const pixelIndex = y * MODEL_INPUT_SIZE + x;
    const pixel = textureLoad(modelInputLayout.$.source, d.vec2i(d.i32(x), d.i32(y)), d.i32(0));

    modelInputLayout.$.output[pixelIndex] = (pixel.x - 0.485) / 0.229;
    modelInputLayout.$.output[MODEL_PIXEL_COUNT + pixelIndex] = (pixel.y - 0.456) / 0.224;
    modelInputLayout.$.output[MODEL_PIXEL_COUNT * 2 + pixelIndex] = (pixel.z - 0.406) / 0.225;
  });

type NormalizationPipeline = ReturnType<typeof createNormalizationPipeline>;

let cachedNormalizationPipeline:
  | { readonly device: GPUDevice; readonly pipeline: NormalizationPipeline }
  | undefined;

const getNormalizationPipeline = (runtime: GpuRuntime): NormalizationPipeline => {
  if (cachedNormalizationPipeline?.device === runtime.device) {
    return cachedNormalizationPipeline.pipeline;
  }

  const pipeline = createNormalizationPipeline(runtime);
  cachedNormalizationPipeline = { device: runtime.device, pipeline };

  return pipeline;
};

export const createGpuModelInput = (
  runtime: GpuRuntime,
  modelCanvas: HTMLCanvasElement,
  timings: RemovalTimingRecorder,
): Effect.Effect<GpuModelInput, InferenceFailed> =>
  Effect.try({
    try: () => {
      const stopGpuPrep = timings.begin("inputUploadMs");
      const sourceTexture = runtime.root
        .createTexture({
          size: [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE],
          format: "rgba8unorm",
        })
        .$usage("sampled");
      const buffer = runtime.device.createBuffer({
        size: MODEL_INPUT_BYTE_LENGTH,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
      });

      try {
        sourceTexture.write(modelCanvas);

        const sourceView = sourceTexture.createView(d.texture2d());
        const outputBuffer = runtime.root.createBuffer(ModelInput, buffer).$usage("storage");
        const bindGroup = runtime.root.createBindGroup(modelInputLayout, {
          source: sourceView,
          output: outputBuffer,
        });

        getNormalizationPipeline(runtime)
          .with(bindGroup)
          .dispatchThreads(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
        stopGpuPrep();

        const tensor = ort.Tensor.fromGpuBuffer(buffer, {
          dataType: "float32",
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
        message: `TypeGPU could not normalize the resized image into the shared ONNX Runtime input buffer. ${String(cause)}`,
      }),
  });

export const releaseGpuModelInput = (input: GpuModelInput): void => {
  input.tensor.dispose();
  input.releaseSourceTexture();
  input.buffer.destroy();
};
