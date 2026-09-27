import { Data, Effect } from "effect";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { CliOptions } from "./args";
import {
  expandCliInputPaths,
  isCliBatchInput,
} from "./input-paths";
import {
  CliOutputPathError,
  resolveBatchOutput,
  resolveSingleOutput,
} from "./output-paths";
import {
  BgcutError,
  createSession,
  removeBackground,
  type BgcutExecutionEngine,
  type BgcutRemovalResult,
} from "../node/index";
import { prepareNativeImage } from "../node/runtime";

export type CliExecutionEngine = BgcutExecutionEngine;

export type CliRemovalItem = {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly engine: CliExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly timings: BgcutRemovalResult["timings"] & {
    readonly writeMs: number;
  };
};

export type CliRemovalFailure = {
  readonly inputPath: string;
  readonly message: string;
};

export type CliRemovalSummary = {
  readonly results: readonly CliRemovalItem[];
  readonly failures: readonly CliRemovalFailure[];
  readonly engine: CliExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly setupTimings: {
    readonly modelMs: number;
    readonly sessionMs: number;
  };
  readonly totalMs: number;
};

export class CliRuntimeError extends Data.TaggedError("CliRuntimeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const prepareImage = prepareNativeImage;

export const removeBackgroundCli = (
  options: CliOptions,
): Effect.Effect<CliRemovalSummary, CliRuntimeError> =>
  Effect.tryPromise({
    try: async () => {
      const totalStartedAt = performance.now();

      const batch = await isCliBatchInput(options.inputPaths);

      const singleOutput = batch
        ? undefined
        : resolveSingleOutput(
            resolve(options.inputPaths[0]),
            options.outputPath,
            options.format,
          );

      const format = singleOutput?.format ?? options.format ?? "png";

      const outputRoot =
        batch && options.outputPath !== undefined
          ? resolve(options.outputPath)
          : undefined;

      const prefixDirectoryRoot = options.inputPaths.length > 1;
      const session = await createSession({ engine: options.engine });
      const results: CliRemovalItem[] = [];
      const failures: CliRemovalFailure[] = [];
      const claimedOutputs = new Set<string>();

      try {
        for await (const source of expandCliInputPaths(options.inputPaths)) {
          let result: BgcutRemovalResult;

          try {
            result = await removeBackground(source.inputPath, {
              session,
              format,
            });
          } catch (cause) {
            if (cause instanceof BgcutError) {
              failures.push({
                inputPath: source.inputPath,
                message: cause.message,
              });
              continue;
            }

            throw cause;
          }

          const outputPath = singleOutput?.outputPath ?? resolveBatchOutput({
            source,
            outputRoot,
            format,
            prefixDirectoryRoot,
          });

          if (resolve(source.inputPath) === outputPath) {
            failures.push({
              inputPath: source.inputPath,
              message: "Input and output paths must be different.",
            });
            continue;
          }

          if (claimedOutputs.has(outputPath)) {
            failures.push({
              inputPath: source.inputPath,
              message: `Another input already maps to ${outputPath}. Choose a different output directory.`,
            });
            continue;
          }

          claimedOutputs.add(outputPath);
          const writeStartedAt = performance.now();

          try {
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, result.data);
          } catch {
            failures.push({
              inputPath: source.inputPath,
              message: `Could not write ${outputPath}.`,
            });
            continue;
          }

          results.push({
            inputPath: source.inputPath,
            outputPath,
            width: result.width,
            height: result.height,
            engine: result.engine,
            fallbackReason: result.fallbackReason,
            timings: {
              ...result.timings,
              writeMs: performance.now() - writeStartedAt,
            },
          });
        }
      } finally {
        await session.close();
      }

      if (results.length === 0 && failures.length === 0) {
        throw new CliRuntimeError({
          message: "No supported JPEG, PNG, WebP, or AVIF images were found.",
        });
      }

      return {
        results,
        failures,
        engine: session.engine,
        fallbackReason: session.fallbackReason,
        setupTimings: session.setupTimings,
        totalMs: performance.now() - totalStartedAt,
      };
    },
    catch: (cause) => {
      if (cause instanceof CliRuntimeError) {
        return cause;
      }

      if (cause instanceof CliOutputPathError) {
        return new CliRuntimeError({
          message: cause.message,
          cause,
        });
      }

      if (cause instanceof BgcutError) {
        return new CliRuntimeError({
          message: cause.message,
          cause,
        });
      }

      return new CliRuntimeError({
        message: "bgcut could not process the requested inputs.",
        cause,
      });
    },
  });
