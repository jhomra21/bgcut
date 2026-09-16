import { Effect } from "effect";
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
  readonly typeGpuUsesSharedDevice: boolean;
};

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
    typeGpuUsesSharedDevice,
  };
});
