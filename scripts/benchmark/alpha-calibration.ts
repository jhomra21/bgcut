import { Schema } from "effect";
import sharp from "sharp";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  join,
  resolve,
} from "node:path";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const BenchmarkManifestSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
});

const CaseMetricsSchema = Schema.Struct({
  id: Schema.String,
  pixels: Schema.Number,
  mae: Schema.Number,
  mse: Schema.Number,
  iou: Schema.Number,
  f1: Schema.Number,
});

const QualityReportSchema = Schema.Struct({
  aggregate: CaseMetricsSchema,
  cases: Schema.Array(CaseMetricsSchema),
});

type CaseMetrics = Schema.Schema.Type<
  typeof CaseMetricsSchema
>;

type QualityReport = Schema.Schema.Type<
  typeof QualityReportSchema
>;

type CalibrationPreset = {
  readonly id: string;
  readonly scale: number;
  readonly bias: number;
};

type CalibrationTiming = {
  readonly id: string;
  readonly milliseconds: number;
  readonly changedPixels: number;
  readonly meanAbsoluteAlphaByteChange: number;
  readonly maxAbsoluteAlphaByteChange: number;
};

type MetricDelta = {
  readonly mae: number;
  readonly mse: number;
  readonly iou: number;
  readonly f1: number;
};

const presets: readonly CalibrationPreset[] = [
  {
    id: "logit-s1.10-b0",
    scale: 1.1,
    bias: 0,
  },
  {
    id: "logit-s1.25-b0",
    scale: 1.25,
    bias: 0,
  },
  {
    id: "logit-s1.10-bp0.10",
    scale: 1.1,
    bias: 0.1,
  },
  {
    id: "logit-s1.10-bm0.10",
    scale: 1.1,
    bias: -0.1,
  },
  {
    id: "logit-s1.25-bp0.15",
    scale: 1.25,
    bias: 0.15,
  },
  {
    id: "logit-s1.25-bm0.15",
    scale: 1.25,
    bias: -0.15,
  },
];

const usage =
  "Usage: bun run benchmark:alpha-calibration -- <manifest.json> <baseline-output-dir> <output-dir>";

const [
  manifestArgument,
  baselineArgument,
  outputArgument,
] = process.argv.slice(2);

if (
  manifestArgument === undefined ||
  baselineArgument === undefined ||
  outputArgument === undefined
) {
  throw new Error(usage);
}

const manifestPath = resolve(manifestArgument);

const baselineRoot = resolve(baselineArgument);

const outputRoot = resolve(outputArgument);

const manifest = Schema.decodeUnknownSync(
  BenchmarkManifestSchema,
)(
  JSON.parse(
    await readFile(manifestPath, "utf8"),
  ),
);

if (manifest.cases.length === 0) {
  throw new Error(
    "Alpha calibration manifest must contain at least one case.",
  );
}

const safeOutputName = (id: string): string =>
  `${id
    .replaceAll("/", "__")
    .replaceAll("\\", "__")}.png`;

const sigmoid = (value: number): number =>
  1 / (1 + Math.exp(-value));

const calibrateAlphaByte = (
  alpha: number,
  preset: CalibrationPreset,
): number => {
  if (alpha === 0 || alpha === 255) {
    return alpha;
  }

  const probability = alpha / 255;
  const logit = Math.log(
    probability /
    (1 - probability),
  );
  const calibrated = sigmoid(
    preset.scale * logit +
    preset.bias,
  );

  return Math.round(
    255 * calibrated,
  );
};

const metricDelta = (
  quality: CaseMetrics,
  baseline: CaseMetrics,
): MetricDelta => ({
  mae: quality.mae - baseline.mae,
  mse: quality.mse - baseline.mse,
  iou: quality.iou - baseline.iou,
  f1: quality.f1 - baseline.f1,
});

const median = (
  values: readonly number[],
): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (left, right) => left - right,
  );

  const middle = Math.floor(
    sorted.length / 2,
  );

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
};

const scoreOutput = async (
  outputDirectory: string,
  reportPath: string,
): Promise<QualityReport> => {
  const process = Bun.spawn(
    [
      "bun",
      "run",
      "benchmark:score",
      "--",
      manifestPath,
      outputDirectory,
      reportPath,
    ],
    {
      cwd: resolve(import.meta.dir, "../.."),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdout =
    await new Response(process.stdout).text();

  const stderr =
    await new Response(process.stderr).text();

  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(
      `Alpha calibration scorer exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }

  return Schema.decodeUnknownSync(
    QualityReportSchema,
  )(
    JSON.parse(
      await readFile(reportPath, "utf8"),
    ),
  );
};

await mkdir(
  outputRoot,
  { recursive: true },
);

const baselineQualityPath = join(
  outputRoot,
  "baseline-quality.json",
);

const baselineQuality = await scoreOutput(
  baselineRoot,
  baselineQualityPath,
);

const baselineCases = new Map(
  baselineQuality.cases.map(
    (metrics) => [
      metrics.id,
      metrics,
    ] as const,
  ),
);

const variantReports = [];

for (const preset of presets) {
  const variantRoot = join(
    outputRoot,
    preset.id,
  );

  await mkdir(
    variantRoot,
    { recursive: true },
  );

  const timings: CalibrationTiming[] = [];

  for (const benchmarkCase of manifest.cases) {
    const outputName =
      safeOutputName(benchmarkCase.id);
    const baselinePath = join(
      baselineRoot,
      outputName,
    );
    const raster = await sharp(
      baselinePath,
    )
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject: true,
      });

    if (raster.info.channels !== 4) {
      throw new Error(
        `Baseline output for ${benchmarkCase.id} is not RGBA.`,
      );
    }

    const calibrated = Buffer.from(
      raster.data,
    );
    let changedPixels = 0;
    let absoluteAlphaChange = 0;
    let maxAbsoluteAlphaByteChange = 0;

    const started = performance.now();

    for (
      let pixel = 0;
      pixel <
        raster.info.width *
        raster.info.height;
      pixel += 1
    ) {
      const alphaIndex =
        pixel * 4 + 3;
      const alpha =
        raster.data[alphaIndex];
      const nextAlpha =
        calibrateAlphaByte(
          alpha,
          preset,
        );

      if (nextAlpha === alpha) {
        continue;
      }

      const difference = Math.abs(
        nextAlpha - alpha,
      );

      calibrated[alphaIndex] =
        nextAlpha;
      changedPixels += 1;
      absoluteAlphaChange +=
        difference;
      maxAbsoluteAlphaByteChange =
        Math.max(
          maxAbsoluteAlphaByteChange,
          difference,
        );
    }

    const milliseconds =
      performance.now() - started;

    await sharp(
      calibrated,
      {
        raw: {
          width: raster.info.width,
          height: raster.info.height,
          channels: 4,
        },
      },
    )
      .png()
      .toFile(
        join(
          variantRoot,
          outputName,
        ),
      );

    timings.push({
      id: benchmarkCase.id,
      milliseconds,
      changedPixels,
      meanAbsoluteAlphaByteChange:
        changedPixels === 0
          ? 0
          : absoluteAlphaChange /
            changedPixels,
      maxAbsoluteAlphaByteChange,
    });
  }

  const qualityPath = join(
    variantRoot,
    "quality.json",
  );

  const quality = await scoreOutput(
    variantRoot,
    qualityPath,
  );

  const caseDeltas = quality.cases.map(
    (metrics) => {
      const baseline =
        baselineCases.get(metrics.id);

      if (baseline === undefined) {
        throw new Error(
          `Baseline quality is missing case ${metrics.id}.`,
        );
      }

      return {
        id: metrics.id,
        delta:
          metricDelta(
            metrics,
            baseline,
          ),
      };
    },
  );

  const totalMilliseconds =
    timings.reduce(
      (total, timing) =>
        total + timing.milliseconds,
      0,
    );

  variantReports.push({
    preset,
    timing: {
      totalMilliseconds,
      medianMilliseconds: median(
        timings.map(
          (timing) =>
            timing.milliseconds,
        ),
      ),
      cases: timings,
    },
    quality,
    delta: metricDelta(
      quality.aggregate,
      baselineQuality.aggregate,
    ),
    caseDeltas,
  });
}

const report = {
  schemaVersion: 1,
  manifest: manifestPath,
  baselineOutputDirectory:
    baselineRoot,
  baselineQuality,
  variants: variantReports,
};

const reportPath = join(
  outputRoot,
  "alpha-calibration.json",
);

await writeFile(
  reportPath,
  `${JSON.stringify(
    report,
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      baseline:
        baselineQuality.aggregate,
      variants: variantReports.map(
        (variant) => ({
          id: variant.preset.id,
          timing:
            variant.timing,
          quality:
            variant.quality.aggregate,
          delta:
            variant.delta,
          caseDeltas:
            variant.caseDeltas,
        }),
      ),
    },
    null,
    2,
  ),
);

console.log(
  `Alpha calibration report: ${reportPath}`,
);
