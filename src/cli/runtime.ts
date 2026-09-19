import { Data, Effect } from "effect";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { CliOptions } from "./args";
import { CliModelError } from "../native/model-cache";
import {
  BgcutImageError,
  BgcutInferenceError,
  BgcutOutputError,
  BgcutSessionError,
  createNativeBgcut,
  prepareNativeImage,
  type BgcutExecutionEngine,
} from "../native/runtime";

export type CliExecutionEngine = BgcutExecutionEngine;

export type CliTimings = {
  readonly totalMs: number;
  readonly modelMs: number;
  readonly prepareMs: number;
  readonly sessionMs: number;
  readonly inferenceMs: number;
  readonly encodeMs: number;
};

export type CliRemovalResult = {
  readonly width: number;
  readonly height: number;
  readonly outputPath: string;
  readonly engine: CliExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly timings: CliTimings;
};

export class CliOutputWriteError extends Data.TaggedError("CliOutputWriteError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const prepareImage = prepareNativeImage;

export const removeBackgroundCli = (
  options: CliOptions,
): Effect.Effect<
  CliRemovalResult,
  | BgcutImageError
  | BgcutSessionError
  | BgcutInferenceError
  | BgcutOutputError
  | CliOutputWriteError
  | CliModelError
> =>
  Effect.suspend(() => {
    const totalStartedAt = performance.now();

    if (resolve(options.inputPath) === resolve(options.outputPath)) {
      return Effect.fail(
        new CliOutputWriteError({
          message: "Input and output paths must be different.",
        }),
      );
    }

    return Effect.acquireUseRelease(
      createNativeBgcut(options.engine),
      (native) =>
        Effect.gen(function* () {
          const result = yield* native.remove(options.inputPath, options.format);
          const writeStartedAt = performance.now();

          yield* Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(options.outputPath), { recursive: true });
              await writeFile(options.outputPath, result.data);
            },
            catch: (cause) =>
              new CliOutputWriteError({
                message: `Could not write ${options.outputPath}.`,
                cause,
              }),
          });

          const writeMs = performance.now() - writeStartedAt;

          return {
            width: result.width,
            height: result.height,
            outputPath: options.outputPath,
            engine: result.engine,
            fallbackReason: result.fallbackReason,
            timings: {
              totalMs: performance.now() - totalStartedAt,
              modelMs: native.setupTimings.modelMs,
              prepareMs: result.timings.prepareMs,
              sessionMs: native.setupTimings.sessionMs,
              inferenceMs: result.timings.inferenceMs,
              encodeMs: result.timings.encodeMs + writeMs,
            },
          };
        }),
      (native) => native.close(),
    );
  });

export {
  BgcutImageError as CliImageError,
  BgcutInferenceError as CliInferenceError,
  BgcutOutputError as CliOutputError,
  BgcutSessionError as CliSessionError,
};
