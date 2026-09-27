import { Data } from "effect";
import { basename, extname, join, parse, resolve } from "node:path";

import type { CliFormat } from "./args";
import type { BgcutFormat } from "../node/index";

export type ResolvedSingleOutput = {
  readonly outputPath: string;
  readonly format: BgcutFormat;
};

export type BatchOutputSource = {
  readonly inputPath: string;
  readonly rootPath?: string;
  readonly relativePath: string;
};

export class CliOutputPathError extends Data.TaggedError("CliOutputPathError")<{
  readonly message: string;
}> {}

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

export const resolveSingleOutput = (
  inputPath: string,
  requestedOutput: string | undefined,
  requestedFormat: CliFormat | undefined,
): ResolvedSingleOutput => {
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
    throw new CliOutputPathError({
      message: `Unsupported output extension "${extension}". Use PNG, WebP, JPG, or JPEG.`,
    });
  }

  if (
    requestedFormat !== undefined &&
    outputFormat !== undefined &&
    requestedFormat !== outputFormat
  ) {
    throw new CliOutputPathError({
      message: `Output path "${requestedOutput}" conflicts with the requested --${requestedFormat} format.`,
    });
  }

  const format = requestedFormat ?? outputFormat ?? "png";

  const outputPath = extension.length === 0
    ? `${requestedOutput}${extensionForFormat(format)}`
    : requestedOutput;

  return {
    outputPath: resolve(outputPath),
    format,
  };
};

type BatchOutputOptions = {
  readonly source: BatchOutputSource;
  readonly outputRoot: string | undefined;
  readonly format: BgcutFormat;
  readonly prefixDirectoryRoot: boolean;
};

export const resolveBatchOutput = (
  options: BatchOutputOptions,
): string => {
  if (options.outputRoot === undefined) {
    return resolve(withOutputSuffix(options.source.inputPath, options.format));
  }

  const relativeSource =
    options.source.rootPath !== undefined && options.prefixDirectoryRoot
      ? join(
          basename(options.source.rootPath),
          options.source.relativePath,
        )
      : options.source.relativePath;

  return resolve(
    options.outputRoot,
    withOutputSuffix(relativeSource, options.format),
  );
};
