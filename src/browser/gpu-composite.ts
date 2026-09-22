import { Effect } from "effect";

import { ImageProcessingFailed } from "./errors";
import type { GpuRuntime } from "./gpu";
import type { GpuModelOutput } from "./gpu-output";
import { MODEL_INPUT_SIZE } from "./image";
import type { RemovalTimingRecorder } from "./timing";

type CompositePipeline = {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly pipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
};

let cachedPipeline: CompositePipeline | undefined;

const shaderSource = `
  struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
  }

  @vertex
  fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2f, 3>(
      vec2f(-1.0, -1.0),
      vec2f(3.0, -1.0),
      vec2f(-1.0, 3.0),
    );
    var uvs = array<vec2f, 3>(
      vec2f(0.0, 1.0),
      vec2f(2.0, 1.0),
      vec2f(0.0, -1.0),
    );

    var output: VertexOutput;
    output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
    output.uv = uvs[vertexIndex];

    return output;
  }

  @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
  @group(0) @binding(1) var sourceSampler: sampler;
  @group(0) @binding(2) var<storage, read> logits: array<f32>;

  fn alphaAt(x: i32, y: i32) -> f32 {
    let maxIndex = ${MODEL_INPUT_SIZE - 1};
    let clampedX = clamp(x, 0, maxIndex);
    let clampedY = clamp(y, 0, maxIndex);
    let index = u32(clampedY) * ${MODEL_INPUT_SIZE}u + u32(clampedX);
    let logit = logits[index];

    return 1.0 / (1.0 + exp(-logit));
  }

  fn sampleAlpha(uv: vec2f) -> f32 {
    let modelPosition =
      uv * vec2f(${MODEL_INPUT_SIZE}.0, ${MODEL_INPUT_SIZE}.0) - vec2f(0.5, 0.5);
    let base = vec2i(floor(modelPosition));
    let fraction = fract(modelPosition);

    let top = mix(
      alphaAt(base.x, base.y),
      alphaAt(base.x + 1, base.y),
      fraction.x,
    );
    let bottom = mix(
      alphaAt(base.x, base.y + 1),
      alphaAt(base.x + 1, base.y + 1),
      fraction.x,
    );

    return mix(top, bottom, fraction.y);
  }

  @fragment
  fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let uv = clamp(input.uv, vec2f(0.0), vec2f(1.0));
    let source = textureSample(sourceTexture, sourceSampler, uv);
    let alpha = source.a * sampleAlpha(uv);

    return vec4f(source.rgb * alpha, alpha);
  }
`;

const getPipeline = (
  runtime: GpuRuntime,
  format: GPUTextureFormat,
): CompositePipeline => {
  if (
    cachedPipeline?.device === runtime.device &&
    cachedPipeline.format === format
  ) {
    return cachedPipeline;
  }

  const module = runtime.device.createShaderModule({
    label: "bgcut GPU composite shader",
    code: shaderSource,
  });

  const pipeline = runtime.device.createRenderPipeline({
    label: "bgcut GPU composite pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vertexMain",
    },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  const sampler = runtime.device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  cachedPipeline = {
    device: runtime.device,
    format,
    pipeline,
    sampler,
  };

  return cachedPipeline;
};

export const createGpuSourceComposite = (
  runtime: GpuRuntime,
  bitmap: ImageBitmap,
  modelOutput: GpuModelOutput,
  timings: RemovalTimingRecorder,
): Effect.Effect<HTMLCanvasElement, ImageProcessingFailed> =>
  Effect.tryPromise({
    try: async () => {
      const stopComposite = timings.begin("compositeMs");
      const canvas = document.createElement("canvas");

      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const context = canvas.getContext("webgpu");

      if (context === null) {
        throw new Error("WebGPU canvas context is unavailable.");
      }

      const format = navigator.gpu.getPreferredCanvasFormat();
      const composite = getPipeline(runtime, format);

      context.configure({
        device: runtime.device,
        format,
        alphaMode: "premultiplied",
        colorSpace: "srgb",
      });

      const sourceTexture = runtime.device.createTexture({
        label: "bgcut GPU composite source",
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });

      try {
        runtime.device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture: sourceTexture },
          [bitmap.width, bitmap.height],
        );

        const bindGroup = runtime.device.createBindGroup({
          layout: composite.pipeline.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: sourceTexture.createView(),
            },
            {
              binding: 1,
              resource: composite.sampler,
            },
            {
              binding: 2,
              resource: {
                buffer: modelOutput.buffer,
              },
            },
          ],
        });

        const encoder = runtime.device.createCommandEncoder({
          label: "bgcut GPU composite encoder",
        });
        const pass = encoder.beginRenderPass({
          label: "bgcut GPU composite pass",
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });

        pass.setPipeline(composite.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();

        runtime.device.queue.submit([encoder.finish()]);
        await runtime.device.queue.onSubmittedWorkDone();
        stopComposite();

        return canvas;
      } finally {
        sourceTexture.destroy();
      }
    },
    catch: (cause) =>
      new ImageProcessingFailed({
        message: `The foreground matte could not be composited on the GPU. ${String(cause)}`,
      }),
  });
