import { Data, Effect } from "effect";
import { dirname, extname, join, parse } from "node:path";

export type CliFormat = "png" | "webp" | "jpg";

export type CliEngine = "auto" | "gpu" | "cpu";

export type CliOptions = {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly format: CliFormat;
  readonly engine: CliEngine;
};

export type ParsedCli =
  | { readonly kind: "help" }
  | { readonly kind: "run"; readonly options: CliOptions };

export class CliArgumentError extends Data.TaggedError("CliArgumentError")<{
  readonly message: string;
}> {}

const formatFlags = new Map<string, CliFormat>([
  ["--png", "png"],
  ["-png", "png"],
  ["--webp", "webp"],
  ["-webp", "webp"],
  ["--jpg", "jpg"],
  ["-jpg", "jpg"],
  ["--jpeg", "jpg"],
  ["-jpeg", "jpg"],
]);

const engineFlags = new Map<string, CliEngine>([
  ["--gpu", "gpu"],
  ["-gpu", "gpu"],
  ["--cpu", "cpu"],
  ["-cpu", "cpu"],
]);

const formatFromExtension = (path: string): CliFormat | undefined => {
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

const extensionForFormat = (format: CliFormat): string => `.${format}`;

const defaultOutputPath = (inputPath: string, format: CliFormat): string => {
  const parsed = parse(inputPath);
  const baseName = parsed.name.length > 0 ? parsed.name : "image";

  return join(dirname(inputPath), `${baseName}-nobg${extensionForFormat(format)}`);
};

const resolveOutputPath = (
  inputPath: string,
  requestedOutput: string | undefined,
  requestedFormat: CliFormat | undefined,
): Effect.Effect<{ readonly outputPath: string; readonly format: CliFormat }, CliArgumentError> =>
  Effect.gen(function* () {
    if (requestedOutput === undefined) {
      const format = requestedFormat ?? "png";

      return { outputPath: defaultOutputPath(inputPath, format), format };
    }

    const extension = extname(requestedOutput);
    const outputFormat = formatFromExtension(requestedOutput);

    if (extension.length > 0 && outputFormat === undefined) {
      return yield* new CliArgumentError({
        message: `Unsupported output extension "${extension}". Use PNG, WebP, JPG, or JPEG.`,
      });
    }

    if (requestedFormat !== undefined && outputFormat !== undefined && requestedFormat !== outputFormat) {
      return yield* new CliArgumentError({
        message: `Output path "${requestedOutput}" conflicts with the requested --${requestedFormat} format.`,
      });
    }

    const format = requestedFormat ?? outputFormat ?? "png";
    const outputPath = extension.length === 0
      ? `${requestedOutput}${extensionForFormat(format)}`
      : requestedOutput;

    return { outputPath, format };
  });

export const parseCliArgs = (args: readonly string[]): Effect.Effect<ParsedCli, CliArgumentError> =>
  Effect.gen(function* () {
    let inputPath: string | undefined;
    let outputPath: string | undefined;
    let format: CliFormat | undefined;
    let engine: CliEngine = "auto";

    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];

      if (argument === "--") {
        continue;
      }

      if (argument === "-h" || argument === "--help") {
        return { kind: "help" };
      }

      if (argument === "--format" || argument === "-f") {
        return yield* new CliArgumentError({
          message: "Use the format itself as a flag: --png, --webp, --jpg, -png, -webp, or -jpg.",
        });
      }

      if (argument === "-o" || argument === "--output") {
        const next = args[index + 1];

        if (next === undefined || next.startsWith("-")) {
          return yield* new CliArgumentError({ message: `${argument} requires an output path.` });
        }

        if (outputPath !== undefined) {
          return yield* new CliArgumentError({ message: "Only one output path can be specified." });
        }

        outputPath = next;
        index += 1;
        continue;
      }

      const requestedFormat = formatFlags.get(argument);

      if (requestedFormat !== undefined) {
        if (format !== undefined && format !== requestedFormat) {
          return yield* new CliArgumentError({ message: "Only one output format can be specified." });
        }

        format = requestedFormat;
        continue;
      }

      const requestedEngine = engineFlags.get(argument);

      if (requestedEngine !== undefined) {
        if (engine !== "auto" && engine !== requestedEngine) {
          return yield* new CliArgumentError({ message: "Choose either GPU or CPU execution, not both." });
        }

        engine = requestedEngine;
        continue;
      }

      if (argument.startsWith("-")) {
        return yield* new CliArgumentError({ message: `Unknown option "${argument}".` });
      }

      if (inputPath !== undefined) {
        return yield* new CliArgumentError({ message: "Only one input image can be processed per command for now." });
      }

      inputPath = argument;
    }

    if (inputPath === undefined) {
      return yield* new CliArgumentError({ message: "An input image path is required." });
    }

    const output = yield* resolveOutputPath(inputPath, outputPath, format);

    return {
      kind: "run",
      options: {
        inputPath,
        outputPath: output.outputPath,
        format: output.format,
        engine,
      },
    };
  });
