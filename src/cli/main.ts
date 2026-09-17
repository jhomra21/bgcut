import { Cause, Effect, Exit } from "effect";

import { parseCliArgs } from "./args";
import { removeBackgroundCli } from "./runtime";

const HELP = `Usage:
  bun run cli -- <image> [format] [options]

Formats:
  --png,  -png             Transparent PNG (default)
  --webp, -webp            Lossless WebP with transparency
  --jpg,  -jpg             JPEG flattened onto white
  --jpeg, -jpeg            Alias for JPG

Options:
  -o, --output <path>      Output filename or path
  --gpu, -gpu              Require native WebGPU
  --cpu, -cpu              Require CPU inference
  -h, --help               Show this help

Examples:
  bun run cli -- photo.jpg -png
  bun run cli -- photo.jpg --webp
  bun run cli -- photo.jpg -o portrait.png
  bun run cli -- photo.jpg -webp -o portrait.webp
  bun run cli -- photo.jpg -gpu
`;

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
