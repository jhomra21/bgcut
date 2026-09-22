import { Schema } from "effect";
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const BenchmarkManifestSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
});

type Raster = {
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array;
};

type MetricTotals = {
  absoluteError: number;
  squaredError: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  pixels: number;
};

type CaseMetrics = {
  readonly id: string;
  readonly pixels: number;
  readonly mae: number;
  readonly mse: number;
  readonly iou: number;
  readonly f1: number;
};

const usage =
  "Usage: bun run benchmark:score -- <manifest.json> <output-dir> [report.json]";

const readLuma = async (path: string): Promise<Raster> => {
  const raw = await sharp(path)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const values = new Uint8Array(raw.info.width * raw.info.height);

  for (let pixel = 0; pixel < values.length; pixel += 1) {
    values[pixel] = raw.data[pixel * raw.info.channels];
  }

  return {
    width: raw.info.width,
    height: raw.info.height,
    values,
  };
};

const readPrediction = async (path: string): Promise<Raster> => {
  const metadata = await sharp(path).metadata();

  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.channels === undefined
  ) {
    throw new Error(`Could not read image metadata from ${path}.`);
  }

  if (metadata.channels !== 2 && metadata.channels !== 4) {
    return readLuma(path);
  }

  const raw = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const values = new Uint8Array(raw.info.width * raw.info.height);
  const alphaChannel = raw.info.channels - 1;

  for (let pixel = 0; pixel < values.length; pixel += 1) {
    values[pixel] = raw.data[pixel * raw.info.channels + alphaChannel];
  }

  return {
    width: raw.info.width,
    height: raw.info.height,
    values,
  };
};

const emptyTotals = (): MetricTotals => ({
  absoluteError: 0,
  squaredError: 0,
  truePositive: 0,
  falsePositive: 0,
  falseNegative: 0,
  pixels: 0,
});

const addPixels = (
  totals: MetricTotals,
  prediction: Uint8Array,
  expected: Uint8Array,
) => {
  for (let pixel = 0; pixel < prediction.length; pixel += 1) {
    const predictedAlpha = prediction[pixel] / 255;
    const expectedAlpha = expected[pixel] / 255;
    const difference = Math.abs(predictedAlpha - expectedAlpha);

    totals.absoluteError += difference;
    totals.squaredError += difference * difference;
    totals.pixels += 1;

    const predictedForeground = prediction[pixel] >= 128;
    const expectedForeground = expected[pixel] >= 128;

    if (predictedForeground && expectedForeground) {
      totals.truePositive += 1;
    } else if (predictedForeground) {
      totals.falsePositive += 1;
    } else if (expectedForeground) {
      totals.falseNegative += 1;
    }
  }
};

const metricsFromTotals = (
  id: string,
  totals: MetricTotals,
): CaseMetrics => {
  const union = totals.truePositive + totals.falsePositive + totals.falseNegative;
  const f1Denominator =
    2 * totals.truePositive + totals.falsePositive + totals.falseNegative;

  return {
    id,
    pixels: totals.pixels,
    mae: totals.absoluteError / totals.pixels,
    mse: totals.squaredError / totals.pixels,
    iou: union === 0 ? 1 : totals.truePositive / union,
    f1: f1Denominator === 0 ? 1 : (2 * totals.truePositive) / f1Denominator,
  };
};

const [manifestArgument, outputArgument, reportArgument] = process.argv.slice(2);

if (manifestArgument === undefined || outputArgument === undefined) {
  throw new Error(usage);
}

const manifestPath = resolve(manifestArgument);
const manifestRoot = dirname(manifestPath);
const outputRoot = resolve(outputArgument);
const reportPath =
  reportArgument === undefined ? join(outputRoot, "quality.json") : resolve(reportArgument);

const manifest = Schema.decodeUnknownSync(BenchmarkManifestSchema)(
  JSON.parse(await readFile(manifestPath, "utf8")),
);

const aggregate = emptyTotals();
const cases: CaseMetrics[] = [];

for (const benchmarkCase of manifest.cases) {
  const outputName = `${benchmarkCase.id.replaceAll("/", "__").replaceAll("\\", "__")}.png`;
  const prediction = await readPrediction(join(outputRoot, outputName));
  const expected = await readLuma(resolve(manifestRoot, benchmarkCase.mask));

  if (prediction.width !== expected.width || prediction.height !== expected.height) {
    throw new Error(
      `${benchmarkCase.id} output is ${prediction.width}x${prediction.height}, expected ${expected.width}x${expected.height}.`,
    );
  }

  const totals = emptyTotals();
  addPixels(totals, prediction.values, expected.values);
  addPixels(aggregate, prediction.values, expected.values);
  cases.push(metricsFromTotals(benchmarkCase.id, totals));
}

const report = {
  schemaVersion: 1,
  outputDirectory: outputRoot,
  metrics: {
    mae: "lower-is-better",
    mse: "lower-is-better",
    iou: "higher-is-better",
    f1: "higher-is-better",
  },
  aggregate: metricsFromTotals("aggregate", aggregate),
  cases,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report.aggregate, null, 2));
console.log(`Quality report: ${reportPath}`);
