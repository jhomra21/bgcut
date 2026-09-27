import { Data, Effect } from "effect";

export type CliFormat = "png" | "webp" | "jpg";

export type CliEngine = "auto" | "gpu" | "cpu";

export type CliOptions = {
  readonly inputPaths: readonly string[];
  readonly outputPath: string | undefined;
  readonly format: CliFormat | undefined;
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
): Effect.Effect<
  { readonly kind: "serve"; readonly options: ServeOptions } | { readonly kind: "help" },
  CliArgumentError
> =>
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

const parseRunArgs = (
  args: readonly string[],
): Effect.Effect<ParsedCli, CliArgumentError> =>
  Effect.gen(function* () {
    const inputPaths: string[] = [];
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

      inputPaths.push(argument);
    }

    if (inputPaths.length === 0) {
      return yield* new CliArgumentError({ message: "At least one input image or directory path is required." });
    }

    return {
      kind: "run",
      options: {
        inputPaths,
        outputPath,
        format,
        engine,
      },
    };
  });

export const parseCliArgs = (
  args: readonly string[],
): Effect.Effect<ParsedCli, CliArgumentError> => {
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
