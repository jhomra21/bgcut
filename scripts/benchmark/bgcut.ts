import { Schema } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  createBgcut,
  type BgcutEngine,
  type BgcutRemovalTimings,
} from "../../src/node";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const BenchmarkManifestSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
});

type CaseReport = {
  readonly id: string;
  readonly input: string;
  readonly output: string;
  readonly width: number;
  readonly height: number;
  readonly firstRun: BgcutRemovalTimings;
  readonly warmRuns: readonly BgcutRemovalTimings[];
  readonly warmMedian: BgcutRemovalTimings;
};

const usage =
  "Usage: bun run benchmark:bgcut -- <manifest.json> <output-dir> [auto|gpu|cpu] [warm-repeats]";

const parseEngine = (value: string): BgcutEngine => {
  if (value === "auto" || value === "gpu" || value === "cpu") {
    return value;
  }

  throw new Error(`Unknown engine "${value}". Expected auto, gpu, or cpu.`);
};

const parseRepeats = (value: string): number => {
  const repeats = Number.parseInt(value, 10);

  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error(`Warm repeats must be a positive integer, received "${value}".`);
  }

  return repeats;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const medianTimings = (
  runs: readonly BgcutRemovalTimings[],
): BgcutRemovalTimings => ({
  totalMs: median(runs.map((run) => run.totalMs)),
  prepareMs: median(runs.map((run) => run.prepareMs)),
  inferenceMs: median(runs.map((run) => run.inferenceMs)),
  encodeMs: median(runs.map((run) => run.encodeMs)),
});

const [manifestArgument, outputArgument, engineArgument = "auto", repeatsArgument = "5"] =
  process.argv.slice(2);

if (manifestArgument === undefined || outputArgument === undefined) {
  throw new Error(usage);
}

const manifestPath = resolve(manifestArgument);
const manifestRoot = dirname(manifestPath);
const outputRoot = resolve(outputArgument);
const requestedEngine = parseEngine(engineArgument);
const warmRepeats = parseRepeats(repeatsArgument);

const manifest = Schema.decodeUnknownSync(BenchmarkManifestSchema)(
  JSON.parse(await readFile(manifestPath, "utf8")),
);

await mkdir(outputRoot, { recursive: true });

const bgcut = await createBgcut({ engine: requestedEngine });
const caseReports: CaseReport[] = [];

try {
  for (const benchmarkCase of manifest.cases) {
    const inputPath = resolve(manifestRoot, benchmarkCase.input);
    const outputName = `${benchmarkCase.id.replaceAll("/", "__").replaceAll("\\", "__")}.png`;
    const outputPath = join(outputRoot, outputName);

    const firstResult = await bgcut.remove(inputPath, { format: "png" });
    await writeFile(outputPath, firstResult.data);

    const warmRuns: BgcutRemovalTimings[] = [];

    for (let run = 0; run < warmRepeats; run += 1) {
      const warmResult = await bgcut.remove(inputPath, { format: "png" });
      warmRuns.push(warmResult.timings);
    }

    caseReports.push({
      id: benchmarkCase.id,
      input: benchmarkCase.input,
      output: outputName,
      width: firstResult.width,
      height: firstResult.height,
      firstRun: firstResult.timings,
      warmRuns,
      warmMedian: medianTimings(warmRuns),
    });
  }
} finally {
  await bgcut.close();
}

const report = {
  schemaVersion: 1,
  tool: "bgcut",
  generatedAt: new Date().toISOString(),
  runtime: {
    platform: process.platform,
    arch: process.arch,
    bun: process.versions.bun ?? null,
    node: process.versions.node,
  },
  requestedEngine,
  selectedEngine: bgcut.engine,
  fallbackReason: bgcut.fallbackReason ?? null,
  setupTimings: bgcut.setupTimings,
  warmRepeats,
  cases: caseReports,
};

const reportPath = join(outputRoot, "timings.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${caseReports.length} bgcut benchmark outputs to ${outputRoot}.`);
console.log(`Timing report: ${reportPath}`);
