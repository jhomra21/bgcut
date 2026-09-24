import { Cause, Data, Effect, Exit } from "effect";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  MODEL_FILENAME,
  MODEL_RELEASE_URL,
  MODEL_SHA256,
  MODEL_SIZE_BYTES,
  WEBGPU_MODEL_FILENAME,
  WEBGPU_MODEL_RELEASE_URL,
  WEBGPU_MODEL_SHA256,
  WEBGPU_MODEL_SIZE_BYTES,
} from "../../src/shared/model-config";
import { inspectModelFile, type ModelFileFingerprint } from "../../src/shared/model-file";

class ModelPrepareError extends Data.TaggedError("ModelPrepareError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type ModelArtifact = {
  readonly filename: string;
  readonly releaseUrl: string;
  readonly sha256: string;
  readonly sizeBytes: number;
};

const artifacts: readonly ModelArtifact[] = [
  {
    filename: MODEL_FILENAME,
    releaseUrl: MODEL_RELEASE_URL,
    sha256: MODEL_SHA256,
    sizeBytes: MODEL_SIZE_BYTES,
  },
  {
    filename: WEBGPU_MODEL_FILENAME,
    releaseUrl: WEBGPU_MODEL_RELEASE_URL,
    sha256: WEBGPU_MODEL_SHA256,
    sizeBytes: WEBGPU_MODEL_SIZE_BYTES,
  },
];

const requestedArtifacts = process.argv.includes("--webgpu-only")
  ? artifacts.filter((artifact) => artifact.filename === WEBGPU_MODEL_FILENAME)
  : artifacts;

const modelPath = (artifact: ModelArtifact): string =>
  resolve(import.meta.dir, "../../public/models", artifact.filename);

const isExpectedModel = (
  artifact: ModelArtifact,
  fingerprint: ModelFileFingerprint | undefined,
): boolean =>
  fingerprint?.sizeBytes === artifact.sizeBytes &&
  fingerprint.sha256 === artifact.sha256;

const prepareArtifact = (artifact: ModelArtifact) =>
  Effect.gen(function* () {
    const path = modelPath(artifact);
    const temporaryPath = `${path}.download`;
    const existing = yield* inspectModelFile(path);

    if (isExpectedModel(artifact, existing)) {
      console.log(`Model already verified at ${path}`);

      return;
    }

    yield* Effect.tryPromise({
      try: () => mkdir(dirname(path), { recursive: true }),
      catch: (cause) =>
        new ModelPrepareError({
          message: `Could not create the model directory for ${path}.`,
          cause,
        }),
    });

    yield* Effect.tryPromise({
      try: () => rm(temporaryPath, { force: true }),
      catch: (cause) =>
        new ModelPrepareError({
          message: `Could not clear the temporary model download at ${temporaryPath}.`,
          cause,
        }),
    });

    const response = yield* Effect.tryPromise({
      try: () => fetch(artifact.releaseUrl),
      catch: (cause) =>
        new ModelPrepareError({
          message: `Could not download the validated model from ${artifact.releaseUrl}.`,
          cause,
        }),
    });

    if (!response.ok) {
      return yield* new ModelPrepareError({
        message: `Validated model download failed with HTTP ${response.status}.`,
      });
    }

    yield* Effect.tryPromise({
      try: () => Bun.write(temporaryPath, response),
      catch: (cause) =>
        new ModelPrepareError({
          message: `Could not write the validated model to ${temporaryPath}.`,
          cause,
        }),
    });

    const downloaded = yield* inspectModelFile(temporaryPath);

    if (!isExpectedModel(artifact, downloaded)) {
      yield* Effect.tryPromise({
        try: () => rm(temporaryPath, { force: true }),
        catch: (cause) =>
          new ModelPrepareError({
            message: `Downloaded model validation failed and ${temporaryPath} could not be removed.`,
            cause,
          }),
      });

      return yield* new ModelPrepareError({
        message: `Downloaded model did not match the expected ${artifact.sizeBytes}-byte artifact with SHA-256 ${artifact.sha256}.`,
      });
    }

    yield* Effect.tryPromise({
      try: async () => {
        await rm(path, { force: true });
        await rename(temporaryPath, path);
      },
      catch: (cause) =>
        new ModelPrepareError({
          message: `Could not install the validated model at ${path}.`,
          cause,
        }),
    });

    console.log(
      `Prepared ${artifact.filename} (${artifact.sizeBytes} bytes, SHA-256 ${artifact.sha256}).`,
    );
  });

const prepareModels = Effect.forEach(requestedArtifacts, prepareArtifact, {
  concurrency: 1,
  discard: true,
});

const exit = await Effect.runPromiseExit(prepareModels);

if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause));
  process.exitCode = 1;
}
