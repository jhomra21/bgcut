import { Effect } from "effect";
import * as ort from "onnxruntime-web/webgpu";
import { tgpu } from "typegpu";

import {
  AdapterUnavailable,
  DeviceRequestFailed,
  RuntimeInitializationFailed,
  WebGpuUnavailable,
  type GpuRuntimeError,
} from "./errors";

export type GpuRuntime = {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly root: ReturnType<typeof tgpu.initFromDevice>;
  readonly ortUsesSharedDevice: boolean;
  readonly typeGpuUsesSharedDevice: boolean;
};

const configureOrt = (device: GPUDevice): Effect.Effect<boolean, RuntimeInitializationFailed> =>
  Effect.tryPromise({
    try: async () => {
      ort.env.webgpu.device = device;
      return (await ort.env.webgpu.device) === device;
    },
    catch: () =>
      new RuntimeInitializationFailed({
        message: "ONNX Runtime could not attach to the application WebGPU device.",
      }),
  });

export const initializeGpuRuntime: Effect.Effect<GpuRuntime, GpuRuntimeError> = Effect.gen(function* () {
  const gpu = navigator.gpu;

  if (gpu === undefined) {
    return yield* new WebGpuUnavailable({
      message: "WebGPU is not available in this browser.",
    });
  }

  const adapter = yield* Effect.tryPromise({
    try: () => gpu.requestAdapter({ powerPreference: "high-performance" }),
    catch: () =>
      new AdapterUnavailable({
        message: "The browser could not request a WebGPU adapter.",
      }),
  });

  if (adapter === null) {
    return yield* new AdapterUnavailable({
      message: "No compatible WebGPU adapter is available.",
    });
  }

  const device = yield* Effect.tryPromise({
    try: () => adapter.requestDevice(),
    catch: () =>
      new DeviceRequestFailed({
        message: "The browser found WebGPU, but creating a GPU device failed.",
      }),
  });

  const ortUsesSharedDevice = yield* configureOrt(device);

  if (!ortUsesSharedDevice) {
    return yield* new RuntimeInitializationFailed({
      message: "ONNX Runtime did not retain the application-owned WebGPU device.",
    });
  }

  const root = yield* Effect.try({
    try: () => tgpu.initFromDevice({ device }),
    catch: () =>
      new RuntimeInitializationFailed({
        message: "TypeGPU could not initialize from the application WebGPU device.",
      }),
  });

  const typeGpuUsesSharedDevice = root.device === device;

  if (!typeGpuUsesSharedDevice) {
    return yield* new RuntimeInitializationFailed({
      message: "TypeGPU did not retain the application-owned WebGPU device.",
    });
  }

  return {
    adapter,
    device,
    root,
    ortUsesSharedDevice,
    typeGpuUsesSharedDevice,
  };
});
