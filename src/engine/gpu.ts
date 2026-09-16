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
  readonly typeGpuUsesSharedDevice: true;
};

const createOrtCompatibleDeviceDescriptor = (adapter: GPUAdapter): GPUDeviceDescriptor => {
  const requiredFeatures: GPUFeatureName[] = [];

  const requireFeatureIfAvailable = (feature: GPUFeatureName): boolean => {
    if (!adapter.features.has(feature)) {
      return false;
    }

    requiredFeatures.push(feature);

    return true;
  };

  // SAFETY: ORT 1.30 uses this Chromium feature string as a GPUFeatureName and requests it only when advertised.
  const chromiumTimestampQuery = "chromium-experimental-timestamp-query-inside-passes" as GPUFeatureName;

  if (!requireFeatureIfAvailable(chromiumTimestampQuery)) {
    requireFeatureIfAvailable("timestamp-query");
  }

  requireFeatureIfAvailable("shader-f16");
  requireFeatureIfAvailable("subgroups");

  return {
    requiredLimits: {
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY,
      maxComputeWorkgroupSizeZ: adapter.limits.maxComputeWorkgroupSizeZ,
    },
    requiredFeatures,
  };
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
    try: () => adapter.requestDevice(createOrtCompatibleDeviceDescriptor(adapter)),
    catch: () =>
      new DeviceRequestFailed({
        message: "The browser found WebGPU, but creating an ONNX Runtime-compatible GPU device failed.",
      }),
  });

  const root = yield* Effect.try({
    try: () => tgpu.initFromDevice({ device }),
    catch: () =>
      new RuntimeInitializationFailed({
        message: "TypeGPU could not initialize from the application WebGPU device.",
      }),
  });

  if (root.device !== device) {
    return yield* new RuntimeInitializationFailed({
      message: "TypeGPU did not retain the application-owned WebGPU device.",
    });
  }

  return {
    adapter,
    device,
    root,
    typeGpuUsesSharedDevice: true,
  };
});