#!/usr/bin/env node

import { Cause, Data, Effect, Exit } from "effect";

import { parseCliArgs } from "./args";
import { removeBackgroundCli } from "./runtime";
import { runLocalApp } from "./server";

const HELP = `Usage:
  bgcut                                Open the local bgcut web app
  bgcut serve [options]                Open the local bgcut web app explicitly
  bgcut <image|directory> [more...]    Remove one or more backgrounds
  bgcut remove <inputs...>             Explicit headless removal command

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
  -o, --output <path>      Output file for one image; output directory for a batch
  --gpu, -gpu              Require native WebGPU
  --cpu, -cpu              Require CPU inference
  -h, --help               Show this help

Batch behavior:
  Directories are scanned recursively for JPEG, PNG, WebP, and AVIF files.
  Batch inference is sequential and reuses one ONNX Runtime session.
  Without --output, each result is written next to its source image.

Examples:
  bgcut
  bgcut serve --port 8787
  bgcut photo.jpg
  bgcut photos/
  bgcut first.jpg second.png --webp
  bgcut photos/ -o ./cutouts
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

  const summary = yield* removeBackgroundCli(parsed.options);

  if (summary.fallbackReason !== undefined) {
    console.log(`↳ WebGPU unavailable; automatic mode used CPU. ${summary.fallbackReason}`);
  }

  for (const result of summary.results) {
    console.log(
      `✓ ${result.engine} · ${result.width}×${result.height} · saved ${result.outputPath}`,
    );
    console.log(
      `  prepare ${formatDuration(result.timings.prepareMs)} · inference ${formatDuration(result.timings.inferenceMs)} · encode ${formatDuration(result.timings.encodeMs + result.timings.writeMs)} · total ${formatDuration(result.timings.totalMs + result.timings.writeMs)}`,
    );
  }

  for (const failure of summary.failures) {
    console.error(`✗ ${failure.inputPath} · ${failure.message}`);
  }

  console.log(
    `  session setup: model ${formatDuration(summary.setupTimings.modelMs)} · session ${formatDuration(summary.setupTimings.sessionMs)} · batch ${formatDuration(summary.totalMs)}`,
  );

  if (summary.failures.length > 0) {
    process.exitCode = 1;
  }
});

const exit = await Effect.runPromiseExit(program);

if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause));
  process.exitCode = 1;
}
