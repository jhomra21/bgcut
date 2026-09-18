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

export type ServeOptions = {
  readonly port: number;
  readonly open: boolean;
  readonly json: boolean;
};

export type ParsedCli =
  | { readonly kind: "help" }
  | { readonly kind: "serve"; readonly options: ServeOptions }
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

const serveFlags = new Set(["--no-open", "--json", "--port"]);

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

const parsePort = (value: string | undefined): Effect.Effect<number, CliArgumentError> =>
  Effect.gen(function* () {
    if (value === undefined || value.startsWith("-")) {
      return yield* new CliArgumentError({ message: "--port requires a port number." });
    }

    const port = Number(value);

    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      return yield* new CliArgumentError({
        message: `Invalid port "${value}". Use 0 for an available port or a value from 1 to 65535.`,
      });
    }

    return port;
  });

const parseServeArgs = (
  args: readonly string[],
): Effect.Effect<{ readonly kind: "serve"; readonly options: ServeOptions } | { readonly kind: "help" }, CliArgumentError> =>
  Effect.gen(function* () {
    let port = 0;
    let open = true;
    let json = false;

    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];

      if (argument === "-h" || argument === "--help") {
        return { kind: "help" };
      }

      if (argument === "--no-open") {
        open = false;
        continue;
      }

      if (argument === "--json") {
        json = true;
        open = false;
        continue;
      }

      if (argument === "--port") {
        port = yield* parsePort(args[index + 1]);
        index += 1;
        continue;
      }

      return yield* new CliArgumentError({
        message: `Unknown local-app option "${argument}". Use --port, --no-open, or --json.`,
      });
    }

    return {
      kind: "serve",
      options: {
        port,
        open,
        json,
      },
    };
  });

const parseRunArgs = (args: readonly string[]): Effect.Effect<ParsedCli, CliArgumentError> =>
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

export const parseCliArgs = (args: readonly string[]): Effect.Effect<ParsedCli, CliArgumentError> => {
  if (args.length === 0) {
    return parseServeArgs([]);
  }

  const [command, ...rest] = args;

  if (command === "serve") {
    return parseServeArgs(rest);
  }

  if (command === "remove") {
    return parseRunArgs(rest);
  }

  if (command !== undefined && serveFlags.has(command)) {
    return parseServeArgs(args);
  }

  return parseRunArgs(args);
};
