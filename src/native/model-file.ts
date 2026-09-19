import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { Data, Effect } from "effect";

export type ModelFileFingerprint = {
  readonly sizeBytes: number;
  readonly sha256: string;
};

export class ModelFileError extends Data.TaggedError("ModelFileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

const isMissingFile = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  cause.code === "ENOENT";

export const inspectModelFile = (
  path: string,
): Effect.Effect<ModelFileFingerprint | undefined, ModelFileError> =>
  Effect.tryPromise({
    try: async () => {
      let file;

      try {
        file = await stat(path);
      } catch (cause) {
        if (isMissingFile(cause)) {
          return undefined;
        }

        throw cause;
      }

      const hasher = createHash("sha256");

      for await (const chunk of createReadStream(path)) {
        hasher.update(chunk);
      }

      return {
        sizeBytes: file.size,
        sha256: hasher.digest("hex"),
      };
    },
    catch: (cause) => new ModelFileError({ path, cause }),
  });
