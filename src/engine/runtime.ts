import { Effect } from "effect";

import type { GpuRuntimeError } from "./errors";
import { initializeGpuRuntime, type GpuRuntime } from "./gpu";

export type GpuCapability = {
  readonly webGpu: true;
  readonly ortWebGpu: true;
  readonly typeGpu: true;
  readonly typeGpuUsesSharedDevice: true;
};

let cachedRuntime: GpuRuntime | undefined;

export const getGpuRuntime: Effect.Effect<GpuRuntime, GpuRuntimeError> = Effect.gen(function* () {
  if (cachedRuntime !== undefined) {
    return cachedRuntime;
  }

  const runtime = yield* initializeGpuRuntime;
  cachedRuntime = runtime;

  void runtime.device.lost.then(() => {
    if (cachedRuntime?.device === runtime.device) {
      cachedRuntime = undefined;
    }
  });

  return runtime;
});

export const checkGpuCapability: Effect.Effect<GpuCapability, GpuRuntimeError> = getGpuRuntime.pipe(
  Effect.map((runtime) => ({
    webGpu: true,
    ortWebGpu: true,
    typeGpu: true,
    typeGpuUsesSharedDevice: runtime.typeGpuUsesSharedDevice,
  })),
);
