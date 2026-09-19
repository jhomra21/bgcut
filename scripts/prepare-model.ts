import { Cause, Data, Effect, Exit } from "effect";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  MODEL_FILENAME,
  MODEL_RELEASE_URL,
  MODEL_SHA256,
  MODEL_SIZE_BYTES,
} from "../src/core/model-config";
import { inspectModelFile, type ModelFileFingerprint } from "./model-file";

class ModelPrepareError extends Data.TaggedError("ModelPrepareError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const modelPath = resolve(import.meta.dir, "../public/models", MODEL_FILENAME);

const temporaryPath = `${modelPath}.download`;

const isExpectedModel = (fingerprint: ModelFileFingerprint | undefined): boolean =>
  fingerprint?.sizeBytes === MODEL_SIZE_BYTES && fingerprint.sha256 === MODEL_SHA256;

const prepareModel = Effect.gen(function* () {
  const existing = yield* inspectModelFile(modelPath);

  if (isExpectedModel(existing)) {
    console.log(`Model already verified at ${modelPath}`);

    return;
  }

  yield* Effect.tryPromise({
    try: () => mkdir(dirname(modelPath), { recursive: true }),
    catch: (cause) =>
      new ModelPrepareError({
        message: `Could not create the model directory for ${modelPath}.`,
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
    try: () => fetch(MODEL_RELEASE_URL),
    catch: (cause) =>
      new ModelPrepareError({
        message: `Could not download the validated model from ${MODEL_RELEASE_URL}.`,
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

  if (!isExpectedModel(downloaded)) {
    yield* Effect.tryPromise({
      try: () => rm(temporaryPath, { force: true }),
      catch: (cause) =>
        new ModelPrepareError({
          message: `Downloaded model validation failed and ${temporaryPath} could not be removed.`,
          cause,
        }),
    });

    return yield* new ModelPrepareError({
      message: `Downloaded model did not match the expected ${MODEL_SIZE_BYTES}-byte artifact with SHA-256 ${MODEL_SHA256}.`,
    });
  }

  yield* Effect.tryPromise({
    try: async () => {
      await rm(modelPath, { force: true });
      await rename(temporaryPath, modelPath);
    },
    catch: (cause) =>
      new ModelPrepareError({
        message: `Could not install the validated model at ${modelPath}.`,
        cause,
      }),
  });

  console.log(`Prepared ${MODEL_FILENAME} (${MODEL_SIZE_BYTES} bytes, SHA-256 ${MODEL_SHA256}).`);
});

const exit = await Effect.runPromiseExit(prepareModel);

if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause));
  process.exitCode = 1;
}
