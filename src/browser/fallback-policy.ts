import { Match } from "effect";

import type { BackgroundRemovalError } from "./errors";

export const shouldFallbackToWasm = (error: BackgroundRemovalError): boolean =>
  Match.value(error).pipe(
    Match.tag(
      "WebGpuUnavailable",
      "AdapterUnavailable",
      "DeviceRequestFailed",
      "RuntimeInitializationFailed",
      "ModelLoadFailed",
      "InferenceFailed",
      () => true,
    ),
    Match.orElse(() => false),
  );
