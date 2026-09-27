import { Data, Effect } from "effect";
import { mkdir, stat, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  parse,
  resolve,
} from "node:path";

import type { CliFormat, CliOptions } from "./args";
import {
  BgcutError,
  createBgcut,
  type BgcutExecutionEngine,
  type BgcutFormat,
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

const outputFormatFromPath = (path: string): CliFormat | undefined => {
  const extension = extname(path).toLowerCase();

  if (extension === ".png") {
    return "png";
  }

  if (extension === ".webp") {
    return "webp";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "jpg";
  }

  return undefined;
};

const extensionForFormat = (format: BgcutFormat): string => `.${format}`;

const withOutputSuffix = (path: string, format: BgcutFormat): string => {
  const parsed = parse(path);
  const baseName = parsed.name.length > 0 ? parsed.name : "image";

  return join(parsed.dir, `${baseName}-nobg${extensionForFormat(format)}`);
};

const resolveSingleOutput = (
  inputPath: string,
  requestedOutput: string | undefined,
  requestedFormat: CliFormat | undefined,
): { readonly outputPath: string; readonly format: BgcutFormat } => {
  if (requestedOutput === undefined) {
    const format = requestedFormat ?? "png";

    return {
      outputPath: withOutputSuffix(inputPath, format),
      format,
    };
  }

  const extension = extname(requestedOutput);
  const outputFormat = outputFormatFromPath(requestedOutput);

  if (extension.length > 0 && outputFormat === undefined) {
    throw new CliRuntimeError({
      message: `Unsupported output extension "${extension}". Use PNG, WebP, JPG, or JPEG.`,
    });
  }

  if (
    requestedFormat !== undefined &&
    outputFormat !== undefined &&
    requestedFormat !== outputFormat
  ) {
    throw new CliRuntimeError({
      message: `Output path "${requestedOutput}" conflicts with the requested --${requestedFormat} format.`,
    });
  }

  const format = requestedFormat ?? outputFormat ?? "png";
  const outputPath = extension.length === 0
    ? `${requestedOutput}${extensionForFormat(format)}`
    : requestedOutput;

  return { outputPath, format };
};

const isBatchInput = async (inputPaths: readonly string[]): Promise<boolean> => {
  if (inputPaths.length > 1) {
    return true;
  }

  try {
    return (await stat(inputPaths[0])).isDirectory();
  } catch {
    return false;
  }
};

const batchOutputPath = (
  inputPath: string,
  rootPath: string | undefined,
  relativePath: string | undefined,
  outputRoot: string | undefined,
  format: BgcutFormat,
  prefixDirectoryRoot: boolean,
): string => {
  if (outputRoot === undefined) {
    return withOutputSuffix(inputPath, format);
  }

  const relativeSource = relativePath ?? basename(inputPath);
  const rootedRelativeSource =
    rootPath !== undefined && prefixDirectoryRoot
      ? join(basename(rootPath), relativeSource)
      : relativeSource;

  return join(outputRoot, withOutputSuffix(rootedRelativeSource, format));
};

const asMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const removeBackgroundCli = (
  options: CliOptions,
): Effect.Effect<CliRemovalSummary, CliRuntimeError> =>
  Effect.tryPromise({
    try: async () => {
      const totalStartedAt = performance.now();
      const batch = await isBatchInput(options.inputPaths);
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
      const bgcut = await createBgcut({ engine: options.engine });
      const results: CliRemovalItem[] = [];
      const failures: CliRemovalFailure[] = [];
      const claimedOutputs = new Set<string>();

      try {
        for await (const item of bgcut.removeMany(options.inputPaths, {
          format,
          recursive: true,
        })) {
          const inputPath =
            typeof item.source.input === "string"
              ? item.source.input
              : "<memory>";

          if (!item.ok) {
            failures.push({
              inputPath,
              message: item.error.message,
            });
            continue;
          }

          const outputPath = singleOutput?.outputPath ?? batchOutputPath(
            inputPath,
            item.source.rootPath,
            item.source.relativePath,
            outputRoot,
            format,
            prefixDirectoryRoot,
          );
          const resolvedOutput = resolve(outputPath);

          if (resolve(inputPath) === resolvedOutput) {
            failures.push({
              inputPath,
              message: "Input and output paths must be different.",
            });
            continue;
          }

          if (claimedOutputs.has(resolvedOutput)) {
            failures.push({
              inputPath,
              message: `Another input already maps to ${outputPath}. Choose a different output directory.`,
            });
            continue;
          }

          claimedOutputs.add(resolvedOutput);
          const writeStartedAt = performance.now();

          try {
            await mkdir(dirname(resolvedOutput), { recursive: true });
            await writeFile(resolvedOutput, item.result.data);
          } catch (cause) {
            failures.push({
              inputPath,
              message: `Could not write ${outputPath}. ${asMessage(cause)}`,
            });
            continue;
          }

          results.push({
            inputPath,
            outputPath: resolvedOutput,
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
      } finally {
        await bgcut.close();
      }

      if (results.length === 0 && failures.length === 0) {
        throw new CliRuntimeError({
          message: "No supported JPEG, PNG, WebP, or AVIF images were found.",
        });
      }

      return {
        results,
        failures,
        engine: bgcut.engine,
        fallbackReason: bgcut.fallbackReason,
        setupTimings: bgcut.setupTimings,
        totalMs: performance.now() - totalStartedAt,
      };
    },
    catch: (cause) => {
      if (cause instanceof CliRuntimeError) {
        return cause;
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
