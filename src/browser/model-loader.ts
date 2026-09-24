import { Effect } from "effect";

import { ModelDownloadFailed } from "./errors";
import { MODEL_PUBLIC_PATH } from "../shared/model-config";

export const fetchModelBytes = (
  modelPath: string = MODEL_PUBLIC_PATH,
): Effect.Effect<Uint8Array, ModelDownloadFailed> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(modelPath, { cache: "force-cache" }),
      catch: () =>
        new ModelDownloadFailed({
          message: "The optimized BiRefNet graph could not be downloaded. Check the network connection and try again.",
        }),
    });

    if (!response.ok) {
      return yield* new ModelDownloadFailed({
        message: `Optimized BiRefNet download failed with HTTP ${response.status}.`,
      });
    }

    const bytes = yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: () =>
        new ModelDownloadFailed({
          message: "The optimized BiRefNet response could not be read.",
        }),
    });

    return new Uint8Array(bytes);
  });
