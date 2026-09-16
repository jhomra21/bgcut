import { Data, Effect } from "effect";

export type ModelFileFingerprint = {
  readonly sizeBytes: number;
  readonly sha256: string;
};

export class ModelFileError extends Data.TaggedError("ModelFileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export const inspectModelFile = (
  path: string,
): Effect.Effect<ModelFileFingerprint | undefined, ModelFileError> =>
  Effect.tryPromise({
    try: async () => {
      const file = Bun.file(path);

      if (!(await file.exists())) {
        return undefined;
      }

      const reader = file.stream().getReader();
      const hasher = new Bun.CryptoHasher("sha256");

      for (;;) {
        const chunk = await reader.read();

        if (chunk.done) {
          break;
        }

        hasher.update(chunk.value);
      }

      return {
        sizeBytes: file.size,
        sha256: hasher.digest("hex"),
      };
    },
    catch: (cause) => new ModelFileError({ path, cause }),
  });
