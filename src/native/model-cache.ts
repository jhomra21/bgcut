import { Data, Effect } from "effect";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  MODEL_FILENAME,
  MODEL_RELEASE_URL,
  MODEL_SHA256,
  MODEL_SIZE_BYTES,
} from "../engine/model-config";
import { inspectModelFile, type ModelFileFingerprint } from "./model-file";

export class CliModelError extends Data.TaggedError("CliModelError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const cacheRoot = (appName: string): string => {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", appName);
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;

    return join(localAppData ?? join(homedir(), "AppData", "Local"), appName);
  }

  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), appName);
};

export const cliModelPath = (): string => join(cacheRoot("bgcut"), "models", MODEL_FILENAME);

const previousCliModelPaths = (): readonly string[] => [
  join(cacheRoot("bgremove"), "models", MODEL_FILENAME),
  join(cacheRoot("removebg-webgpu"), "models", MODEL_FILENAME),
];

const isExpectedModel = (fingerprint: ModelFileFingerprint | undefined): boolean =>
  fingerprint?.sizeBytes === MODEL_SIZE_BYTES && fingerprint.sha256 === MODEL_SHA256;

const inspectCachedModel = (path: string): Effect.Effect<ModelFileFingerprint | undefined, CliModelError> =>
  inspectModelFile(path).pipe(
    Effect.mapError((cause) =>
      new CliModelError({ message: `Could not inspect the cached model at ${path}.`, cause }),
    ),
  );

export const ensureCliModel = (): Effect.Effect<string, CliModelError> =>
  Effect.gen(function* () {
    const modelPath = cliModelPath();
    const existing = yield* inspectCachedModel(modelPath);

    if (isExpectedModel(existing)) {
      return modelPath;
    }

    for (const previousModelPath of previousCliModelPaths()) {
      const previousExisting = yield* inspectCachedModel(previousModelPath);

      if (isExpectedModel(previousExisting)) {
        return previousModelPath;
      }
    }

    const temporaryPath = `${modelPath}.download`;

    yield* Effect.tryPromise({
      try: () => mkdir(dirname(modelPath), { recursive: true }),
      catch: (cause) => new CliModelError({ message: `Could not create ${dirname(modelPath)}.`, cause }),
    });

    yield* Effect.tryPromise({
      try: () => rm(temporaryPath, { force: true }),
      catch: (cause) => new CliModelError({ message: `Could not clear ${temporaryPath}.`, cause }),
    });

    const response = yield* Effect.tryPromise({
      try: () => fetch(MODEL_RELEASE_URL),
      catch: (cause) =>
        new CliModelError({ message: "Could not download the validated BiRefNet model.", cause }),
    });

    if (!response.ok) {
      return yield* new CliModelError({
        message: `Validated model download failed with HTTP ${response.status}.`,
      });
    }

    yield* Effect.tryPromise({
      try: async () => {
        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(temporaryPath, bytes);
      },
      catch: (cause) => new CliModelError({ message: `Could not write ${temporaryPath}.`, cause }),
    });

    const downloaded = yield* inspectModelFile(temporaryPath).pipe(
      Effect.mapError((cause) =>
        new CliModelError({ message: `Could not verify ${temporaryPath}.`, cause }),
      ),
    );

    if (!isExpectedModel(downloaded)) {
      yield* Effect.tryPromise({
        try: () => rm(temporaryPath, { force: true }),
        catch: (cause) => new CliModelError({ message: `Could not remove invalid ${temporaryPath}.`, cause }),
      });

      return yield* new CliModelError({
        message: `Downloaded model did not match the expected ${MODEL_SIZE_BYTES}-byte artifact with SHA-256 ${MODEL_SHA256}.`,
      });
    }

    yield* Effect.tryPromise({
      try: async () => {
        await rm(modelPath, { force: true });
        await rename(temporaryPath, modelPath);
      },
      catch: (cause) => new CliModelError({ message: `Could not install the model at ${modelPath}.`, cause }),
    });

    return modelPath;
  });
