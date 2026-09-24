import { Data, Effect } from "effect";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  MODEL_FILENAME,
  MODEL_RELEASE_URL,
  MODEL_SHA256,
  MODEL_SIZE_BYTES,
  WEBGPU_MODEL_FILENAME,
  WEBGPU_MODEL_RELEASE_URL,
  WEBGPU_MODEL_SHA256,
  WEBGPU_MODEL_SIZE_BYTES,
} from "../shared/model-config";
import { inspectModelFile, type ModelFileFingerprint } from "../shared/model-file";

export class ModelCacheError extends Data.TaggedError("ModelCacheError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type CachedModel = {
  readonly filename: string;
  readonly releaseUrl: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly previousPaths?: () => readonly string[];
};

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

const cachedPath = (filename: string): string =>
  join(cacheRoot("bgcut"), "models", filename);

export const cachedModelPath = (): string => cachedPath(MODEL_FILENAME);

export const cachedWebGpuModelPath = (): string =>
  cachedPath(WEBGPU_MODEL_FILENAME);

const fp32Model: CachedModel = {
  filename: MODEL_FILENAME,
  releaseUrl: MODEL_RELEASE_URL,
  sha256: MODEL_SHA256,
  sizeBytes: MODEL_SIZE_BYTES,
  previousPaths: () => [
    join(cacheRoot("bgremove"), "models", MODEL_FILENAME),
    join(cacheRoot("removebg-webgpu"), "models", MODEL_FILENAME),
  ],
};

const webGpuModel: CachedModel = {
  filename: WEBGPU_MODEL_FILENAME,
  releaseUrl: WEBGPU_MODEL_RELEASE_URL,
  sha256: WEBGPU_MODEL_SHA256,
  sizeBytes: WEBGPU_MODEL_SIZE_BYTES,
};

const isExpectedModel = (
  model: CachedModel,
  fingerprint: ModelFileFingerprint | undefined,
): boolean =>
  fingerprint?.sizeBytes === model.sizeBytes &&
  fingerprint.sha256 === model.sha256;

const inspectCachedModel = (
  path: string,
): Effect.Effect<ModelFileFingerprint | undefined, ModelCacheError> =>
  inspectModelFile(path).pipe(
    Effect.mapError(
      (cause) =>
        new ModelCacheError({
          message: `Could not inspect the cached model at ${path}.`,
          cause,
        }),
    ),
  );

const ensureCachedArtifact = (
  model: CachedModel,
): Effect.Effect<string, ModelCacheError> =>
  Effect.gen(function* () {
    const modelPath = cachedPath(model.filename);
    const existing = yield* inspectCachedModel(modelPath);

    if (isExpectedModel(model, existing)) {
      return modelPath;
    }

    for (const previousModelPath of model.previousPaths?.() ?? []) {
      const previousExisting = yield* inspectCachedModel(previousModelPath);

      if (isExpectedModel(model, previousExisting)) {
        return previousModelPath;
      }
    }

    const temporaryPath = `${modelPath}.download`;

    yield* Effect.tryPromise({
      try: () => mkdir(dirname(modelPath), { recursive: true }),
      catch: (cause) =>
        new ModelCacheError({
          message: `Could not create ${dirname(modelPath)}.`,
          cause,
        }),
    });

    yield* Effect.tryPromise({
      try: () => rm(temporaryPath, { force: true }),
      catch: (cause) =>
        new ModelCacheError({
          message: `Could not clear ${temporaryPath}.`,
          cause,
        }),
    });

    const response = yield* Effect.tryPromise({
      try: () => fetch(model.releaseUrl),
      catch: (cause) =>
        new ModelCacheError({
          message: "Could not download the validated BiRefNet model.",
          cause,
        }),
    });

    if (!response.ok) {
      return yield* new ModelCacheError({
        message: `Validated model download failed with HTTP ${response.status}.`,
      });
    }

    yield* Effect.tryPromise({
      try: async () => {
        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(temporaryPath, bytes);
      },
      catch: (cause) =>
        new ModelCacheError({
          message: `Could not write ${temporaryPath}.`,
          cause,
        }),
    });

    const downloaded = yield* inspectModelFile(temporaryPath).pipe(
      Effect.mapError(
        (cause) =>
          new ModelCacheError({
            message: `Could not verify ${temporaryPath}.`,
            cause,
          }),
      ),
    );

    if (!isExpectedModel(model, downloaded)) {
      yield* Effect.tryPromise({
        try: () => rm(temporaryPath, { force: true }),
        catch: (cause) =>
          new ModelCacheError({
            message: `Could not remove invalid ${temporaryPath}.`,
            cause,
          }),
      });

      return yield* new ModelCacheError({
        message: `Downloaded model did not match the expected ${model.sizeBytes}-byte artifact with SHA-256 ${model.sha256}.`,
      });
    }

    yield* Effect.tryPromise({
      try: async () => {
        await rm(modelPath, { force: true });
        await rename(temporaryPath, modelPath);
      },
      catch: (cause) =>
        new ModelCacheError({
          message: `Could not install the model at ${modelPath}.`,
          cause,
        }),
    });

    return modelPath;
  });

export const ensureCachedModel = (): Effect.Effect<string, ModelCacheError> =>
  ensureCachedArtifact(fp32Model);

export const ensureCachedWebGpuModel = (): Effect.Effect<string, ModelCacheError> =>
  ensureCachedArtifact(webGpuModel);
