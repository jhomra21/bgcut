import { Cause, Data, Effect, Exit } from "effect";
import { resolve } from "node:path";

import {
  MODEL_FILENAME,
  MODEL_SHA256,
  MODEL_SIZE_BYTES,
  WEBGPU_MODEL_FILENAME,
  WEBGPU_MODEL_SHA256,
  WEBGPU_MODEL_SIZE_BYTES,
} from "../../src/shared/model-config";
import { inspectModelFile } from "../../src/shared/model-file";

class ModelVerificationError extends Data.TaggedError("ModelVerificationError")<{
  readonly message: string;
}> {}

type ModelArtifact = {
  readonly filename: string;
  readonly sha256: string;
  readonly sizeBytes: number;
};

const artifacts: readonly ModelArtifact[] = [
  {
    filename: MODEL_FILENAME,
    sha256: MODEL_SHA256,
    sizeBytes: MODEL_SIZE_BYTES,
  },
  {
    filename: WEBGPU_MODEL_FILENAME,
    sha256: WEBGPU_MODEL_SHA256,
    sizeBytes: WEBGPU_MODEL_SIZE_BYTES,
  },
];

const verifyArtifact = (artifact: ModelArtifact) =>
  Effect.gen(function* () {
    const path = resolve(import.meta.dir, "../../dist/models", artifact.filename);
    const fingerprint = yield* inspectModelFile(path);

    if (
      fingerprint?.sizeBytes !== artifact.sizeBytes ||
      fingerprint.sha256 !== artifact.sha256
    ) {
      return yield* new ModelVerificationError({
        message: `Built model did not match the expected ${artifact.sizeBytes}-byte artifact with SHA-256 ${artifact.sha256}.`,
      });
    }

    console.log(`Verified production model at ${path}.`);
  });

const verifyBuiltModels = Effect.forEach(artifacts, verifyArtifact, {
  concurrency: 1,
  discard: true,
});

const exit = await Effect.runPromiseExit(verifyBuiltModels);

if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause));
  process.exitCode = 1;
}
