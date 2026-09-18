#!/usr/bin/env node

import { Cause, Data, Effect, Exit } from "effect";

import { parseCliArgs } from "./args";
import { removeBackgroundCli } from "./runtime";
import { runLocalApp } from "./server";

const HELP = `Usage:
  bgcut                         Open the local bgcut web app
  bgcut serve [options]         Open the local bgcut web app explicitly
  bgcut <image> [format]        Remove a background and save the result
  bgcut remove <image> [format] Explicit headless removal command

Local app options:
  --port <number>          Use a specific localhost port (default: available port)
  --no-open                Start the local app without opening a browser
  --json                   Print machine-readable server info and do not open a browser

Formats:
  --png,  -png             Transparent PNG (default)
  --webp, -webp            Lossless WebP with transparency
  --jpg,  -jpg             JPEG flattened onto white
  --jpeg, -jpeg            Alias for JPG

Removal options:
  -o, --output <path>      Output filename or path
  --gpu, -gpu              Require native WebGPU
  --cpu, -cpu              Require CPU inference
  -h, --help               Show this help

Examples:
  bgcut
  bgcut serve --port 8787
  bgcut photo.jpg
  bgcut remove photo.jpg --webp
  bgcut photo.jpg -o portrait.png
  bgcut photo.jpg -gpu
`;

class CliServerError extends Data.TaggedError("CliServerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 10) {
    return `${milliseconds.toFixed(1)} ms`;
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }

  return `${(milliseconds / 1000).toFixed(2)} s`;
};

const program = Effect.gen(function* () {
  const parsed = yield* parseCliArgs(process.argv.slice(2));

  if (parsed.kind === "help") {
    console.log(HELP);

    return;
  }

  if (parsed.kind === "serve") {
    yield* Effect.tryPromise({
      try: () => runLocalApp(parsed.options),
      catch: (cause) =>
        new CliServerError({
          message: "Could not start the local bgcut web app.",
          cause,
        }),
    });

    return;
  }

  const result = yield* removeBackgroundCli(parsed.options);
  const timings = result.timings;

  console.log(`✓ ${result.engine} · ${result.width}×${result.height} · saved ${result.outputPath}`);

  if (result.fallbackReason !== undefined) {
    console.log(`↳ WebGPU unavailable; automatic mode used CPU. ${result.fallbackReason}`);
  }

  console.log(
    `  model ${formatDuration(timings.modelMs)} · prepare ${formatDuration(timings.prepareMs)} · session ${formatDuration(timings.sessionMs)} · inference ${formatDuration(timings.inferenceMs)} · encode ${formatDuration(timings.encodeMs)} · total ${formatDuration(timings.totalMs)}`,
  );
});

const exit = await Effect.runPromiseExit(program);

if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause));
  process.exitCode = 1;
}
