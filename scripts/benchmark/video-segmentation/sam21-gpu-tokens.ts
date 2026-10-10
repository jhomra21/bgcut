import * as ort from "onnxruntime-web/webgpu";

/**
 * Experimental WebGPU transpose for SAM's [1, channels, height, width]
 * feature map to memory attention's [tokens, 1, channels] input.
 *
 * The caller owns the returned buffer. Release it only after the ONNX
 * memory-attention run has consumed the tensor.
 */
export const createSamGpuTokenTransposer = (
  device: GPUDevice,
  featureTokens: number,
  featureChannels: number,
) => {
  if (!Number.isSafeInteger(featureTokens) || featureTokens <= 0 ||
      !Number.isSafeInteger(featureChannels) || featureChannels <= 0) {
    throw new Error("SAM GPU token transpose requires positive integer dimensions.");
  }

  const shader = device.createShaderModule({
    code: `
      @group(0) @binding(0) var<storage, read> features: array<f32>;
      @group(0) @binding(1) var<storage, read_write> tokens: array<f32>;

      const CHANNELS: u32 = ${featureChannels}u;
      const FEATURE_TOKENS: u32 = ${featureTokens}u;

      @compute @workgroup_size(256)
      fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
        let outputIndex = invocation.x;
        if (outputIndex >= CHANNELS * FEATURE_TOKENS) {
          return;
        }
        let token = outputIndex / CHANNELS;
        let channel = outputIndex % CHANNELS;
        tokens[outputIndex] = features[channel * FEATURE_TOKENS + token];
      }
    `,
  });

  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shader,
      entryPoint: "main",
    },
  });

  const outputBytes = featureTokens * featureChannels * Float32Array.BYTES_PER_ELEMENT;

  return (features: ort.Tensor) => {
    if (features.location !== "gpu-buffer" || features.type !== "float32") {
      throw new Error("SAM GPU token transpose requires a float32 GPU feature tensor.");
    }

    const elementCount = features.dims.reduce((total, size) => total * size, 1);

    if (elementCount !== featureTokens * featureChannels ||
        features.gpuBuffer.size < outputBytes) {
      throw new Error("SAM GPU feature input has unexpected geometry.");
    }

    const buffer = device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    try {
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: features.gpuBuffer } },
          { binding: 1, resource: { buffer } },
        ],
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();

      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(featureTokens * featureChannels / 256));
      pass.end();
      device.queue.submit([encoder.finish()]);

      const tensor = ort.Tensor.fromGpuBuffer(buffer, {
        dataType: "float32",
        dims: [featureTokens, 1, featureChannels],
      });

      return {
        tensor,
        release() {
          tensor.dispose();
          buffer.destroy();
        },
      };
    } catch (error) {
      buffer.destroy();
      throw error;
    }
  };
};
