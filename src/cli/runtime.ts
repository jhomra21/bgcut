import { Data, Effect, Either, Schema } from "effect";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { CliOptions } from "./args";
import {
  CliOutputPathError,
  resolveBatchOutput,
  resolveSingleOutput,
  type BatchOutputSource,
} from "./output-paths";
import {
  BgcutError,
  bgcut,
  type BgcutExecutionEngine,
  type BgcutInputSource,
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

const decodePath = (input: BgcutInputSource["input"]): string => {
  const decoded = Schema.decodeUnknownEither(Schema.String)(input);

  if (Either.isLeft(decoded)) {
    throw new CliRuntimeError({
      message: "CLI removal received an in-memory input unexpectedly.",
    });
  }

  return decoded.right;
};

const toBatchOutputSource = (
  source: BgcutInputSource,
): BatchOutputSource => {
  const inputPath = decodePath(source.input);

  return {
    inputPath,
    rootPath: source.rootPath,
    relativePath: source.relativePath ?? inputPath,
  };
};

const isBatchInput = async (
  inputPaths: readonly string[],
): Promise<boolean> => {
  if (inputPaths.length > 1) {
    return true;
  }

  const inputPath = inputPaths.at(0);

  if (inputPath === undefined) {
    return false;
  }

  try {
    return (await stat(inputPath)).isDirectory();
  } catch {
    return false;
  }
};

export const removeBackgroundCli = (
  options: CliOptions,
): Effect.Effect<CliRemovalSummary, CliRuntimeError> =>
  Effect.tryPromise({
    try: async () => {
      const totalStartedAt = performance.now();

      const batch = await isBatchInput(options.inputPaths);

      const format = options.format ?? "png";

      const remover = await bgcut({ engine: options.engine });

      const results: CliRemovalItem[] = [];
      const failures: CliRemovalFailure[] = [];

      try {
        if (!batch) {
          const inputPath = resolve(options.inputPaths[0]);

          const output = resolveSingleOutput(
            inputPath,
            options.outputPath,
            options.format,
          );

          const result = await remover.removeBackground(inputPath, {
            format: output.format,
          });
          const writeStartedAt = performance.now();

          await mkdir(dirname(output.outputPath), { recursive: true });
          await writeFile(output.outputPath, result.data);

          results.push({
            inputPath,
            outputPath: output.outputPath,
            width: result.width,
            height: result.height,
            engine: result.engine,
            fallbackReason: result.fallbackReason,
            timings: {
              ...result.timings,
              writeMs: performance.now() - writeStartedAt,
            },
          });
        } else {
          const outputRoot =
            options.outputPath === undefined
              ? undefined
              : resolve(options.outputPath);

          const prefixDirectoryRoot = options.inputPaths.length > 1;
          const claimedOutputs = new Set<string>();

          for await (const item of remover.removeMany(options.inputPaths, {
            format,
          })) {
            const source = toBatchOutputSource(item.source);

            if (!item.ok) {
              failures.push({
                inputPath: source.inputPath,
                message: item.error.message,
              });
              continue;
            }

            const outputPath = resolveBatchOutput({
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
              await writeFile(outputPath, item.result.data);
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
              width: item.result.width,
              height: item.result.height,
              engine: item.result.engine,
              fallbackReason: item.result.fallbackReason,
              timings: {
                ...item.result.timings,
                writeMs: performance.now() - writeStartedAt,
              },
            });
          }
        }
      } finally {
        await remover.close();
      }

      return {
        results,
        failures,
        engine: remover.engine,
        fallbackReason: remover.fallbackReason,
        setupTimings: remover.setupTimings,
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
