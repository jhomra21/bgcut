import { Cause, Data, Effect, Exit } from "effect";
import { resolve } from "node:path";

import {
  MODEL_FILENAME,
  MODEL_SHA256,
  MODEL_SIZE_BYTES,
} from "../../src/core/model";
import { inspectModelFile } from "../../src/native/model-file";

class ModelVerificationError extends Data.TaggedError("ModelVerificationError")<{
  readonly message: string;
}> {}

const builtModelPath = resolve(import.meta.dir, "../../dist/models", MODEL_FILENAME);

const verifyBuiltModel = Effect.gen(function* () {
  const fingerprint = yield* inspectModelFile(builtModelPath);

  if (
    fingerprint?.sizeBytes !== MODEL_SIZE_BYTES ||
    fingerprint.sha256 !== MODEL_SHA256
  ) {
    return yield* new ModelVerificationError({
      message: `Built model did not match the expected ${MODEL_SIZE_BYTES}-byte artifact with SHA-256 ${MODEL_SHA256}.`,
    });
  }

  console.log(`Verified production model at ${builtModelPath}.`);
});

const exit = await Effect.runPromiseExit(verifyBuiltModel);

if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause));
  process.exitCode = 1;
}
