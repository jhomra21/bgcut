import * as ort from "onnxruntime-web/webgpu";

const WORKGROUP_SIZE = 8;

const createTransposeShader = (
  tokenCount: number,
  channelCount: number,
): string => `
@group(0) @binding(0)
var<storage, read> source: array<f32>;

@group(0) @binding(1)
var<storage, read_write> destination: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(
  @builtin(global_invocation_id)
  id: vec3<u32>,
) {
  let token = id.x;
  let channel = id.y;

  if (
    token >= ${tokenCount}u ||
    channel >= ${channelCount}u
  ) {
    return;
  }

  destination[
    token * ${channelCount}u +
    channel
  ] = source[
    channel * ${tokenCount}u +
    token
  ];
}
`;

export const requireGpuBuffer = (
  tensor: ort.Tensor,
  label: string,
): GPUBuffer => {
  if (
    tensor.location !==
    "gpu-buffer"
  ) {
    throw new Error(
      `${label} is not GPU-resident.`,
    );
  }

  return tensor.gpuBuffer;
};

export class SamFeatureTransposer {
  readonly #device:
    GPUDevice;

  readonly #pipeline:
    GPUComputePipeline;

  readonly #output:
    GPUBuffer;

  readonly #tokenCount:
    number;

  readonly #channelCount:
    number;

  constructor(
    device: GPUDevice,
    tokenCount: number,
    channelCount: number,
  ) {
    this.#device =
      device;

    this.#tokenCount =
      tokenCount;

    this.#channelCount =
      channelCount;

    this.#pipeline =
      device.createComputePipeline({
        label:
          "bgcut SAM feature transpose",
        layout:
          "auto",
        compute: {
          module:
            device.createShaderModule({
              label:
                "bgcut SAM feature transpose",
              code:
                createTransposeShader(
                  tokenCount,
                  channelCount,
                ),
            }),
          entryPoint:
            "main",
        },
      });

    this.#output =
      device.createBuffer({
        label:
          "bgcut SAM feature tokens",
        size:
          tokenCount *
          channelCount *
          Float32Array.BYTES_PER_ELEMENT,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      });
  }

  run(
    source: GPUBuffer,
  ): ort.Tensor {
    const bindGroup =
      this.#device.createBindGroup({
        layout:
          this.#pipeline
            .getBindGroupLayout(
              0,
            ),
        entries: [
          {
            binding: 0,
            resource: {
              buffer:
                source,
            },
          },
          {
            binding: 1,
            resource: {
              buffer:
                this.#output,
            },
          },
        ],
      });

    const encoder =
      this.#device
        .createCommandEncoder({
          label:
            "bgcut SAM feature transpose",
        });

    const pass =
      encoder.beginComputePass({
        label:
          "bgcut SAM feature transpose",
      });

    pass.setPipeline(
      this.#pipeline,
    );

    pass.setBindGroup(
      0,
      bindGroup,
    );

    pass.dispatchWorkgroups(
      Math.ceil(
        this.#tokenCount /
          WORKGROUP_SIZE,
      ),
      Math.ceil(
        this.#channelCount /
          WORKGROUP_SIZE,
      ),
    );

    pass.end();

    this.#device.queue.submit([
      encoder.finish(),
    ]);

    return ort.Tensor.fromGpuBuffer(
      this.#output,
      {
        dataType:
          "float32",
        dims: [
          this.#tokenCount,
          1,
          this.#channelCount,
        ],
      },
    );
  }

  dispose(): void {
    this.#output.destroy();
  }
}

export const createSamFeatureTransposer =
  async (
    tokenCount: number,
    channelCount: number,
  ): Promise<
    SamFeatureTransposer
  > =>
    new SamFeatureTransposer(
      await ort.env.webgpu.device,
      tokenCount,
      channelCount,
    );
