import { Schema } from "effect";
import sharp from "sharp";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
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

const QualityAggregateSchema = Schema.Struct({
  id: Schema.String,
  pixels: Schema.Number,
  mae: Schema.Number,
  mse: Schema.Number,
  iou: Schema.Number,
  f1: Schema.Number,
});

const QualityReportSchema = Schema.Struct({
  aggregate: QualityAggregateSchema,
});

type RefinementPreset = {
  readonly id: string;
  readonly radius: number;
  readonly backgroundAlphaMax: number;
  readonly foregroundAlphaMin: number;
  readonly blend: number;
};

type RefinementCaseTiming = {
  readonly id: string;
  readonly milliseconds: number;
  readonly uncertainPixels: number;
  readonly refinedPixels: number;
};

type RefinementResult = {
  readonly output: Buffer;
  readonly uncertainPixels: number;
  readonly refinedPixels: number;
};

const presets: readonly RefinementPreset[] = [
  {
    id: "source-snap-r2-b25",
    radius: 2,
    backgroundAlphaMax: 32,
    foregroundAlphaMin: 223,
    blend: 0.25,
  },
  {
    id: "source-snap-r3-b35",
    radius: 3,
    backgroundAlphaMax: 32,
    foregroundAlphaMin: 223,
    blend: 0.35,
  },
  {
    id: "source-snap-r4-b50",
    radius: 4,
    backgroundAlphaMax: 24,
    foregroundAlphaMin: 231,
    blend: 0.5,
  },
];

const usage =
  "Usage: bun run benchmark:matte-refinement -- <manifest.json> <baseline-output-dir> <output-dir>";

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

const manifestRoot = dirname(manifestPath);

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
    "Matte refinement manifest must contain at least one case.",
  );
}

const safeOutputName = (id: string): string =>
  `${id
    .replaceAll("/", "__")
    .replaceAll("\\", "__")}.png`;

const colorDistanceSquared = (
  source: Buffer,
  leftIndex: number,
  rightIndex: number,
): number => {
  const leftOffset = leftIndex * 4;

  const rightOffset = rightIndex * 4;

  const red =
    source[leftOffset] -
    source[rightOffset];

  const green =
    source[leftOffset + 1] -
    source[rightOffset + 1];

  const blue =
    source[leftOffset + 2] -
    source[rightOffset + 2];

  return (
    red * red +
    green * green +
    blue * blue
  );
};

const refineAlpha = (
  source: Buffer,
  baseline: Buffer,
  width: number,
  height: number,
  preset: RefinementPreset,
): RefinementResult => {
  const output = Buffer.from(baseline);
  let uncertainPixels = 0;
  let refinedPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const rgbaIndex = pixelIndex * 4;
      const alpha = baseline[rgbaIndex + 3];

      if (
        alpha <= preset.backgroundAlphaMax ||
        alpha >= preset.foregroundAlphaMin
      ) {
        continue;
      }

      uncertainPixels += 1;

      let foregroundDistance = Number.POSITIVE_INFINITY;
      let backgroundDistance = Number.POSITIVE_INFINITY;

      const startY = Math.max(
        0,
        y - preset.radius,
      );

      const endY = Math.min(
        height - 1,
        y + preset.radius,
      );

      const startX = Math.max(
        0,
        x - preset.radius,
      );

      const endX = Math.min(
        width - 1,
        x + preset.radius,
      );

      for (
        let neighborY = startY;
        neighborY <= endY;
        neighborY += 1
      ) {
        for (
          let neighborX = startX;
          neighborX <= endX;
          neighborX += 1
        ) {
          const neighborIndex =
            neighborY * width + neighborX;

          const neighborAlpha =
            baseline[neighborIndex * 4 + 3];

          if (
            neighborAlpha > preset.backgroundAlphaMax &&
            neighborAlpha < preset.foregroundAlphaMin
          ) {
            continue;
          }

          const distance = colorDistanceSquared(
            source,
            pixelIndex,
            neighborIndex,
          );

          if (
            neighborAlpha >= preset.foregroundAlphaMin
          ) {
            foregroundDistance = Math.min(
              foregroundDistance,
              distance,
            );
          } else {
            backgroundDistance = Math.min(
              backgroundDistance,
              distance,
            );
          }
        }
      }

      if (
        !Number.isFinite(foregroundDistance) ||
        !Number.isFinite(backgroundDistance)
      ) {
        continue;
      }

      const distanceTotal =
        foregroundDistance +
        backgroundDistance;

      if (distanceTotal === 0) {
        continue;
      }

      const sourceAlpha =
        255 *
        backgroundDistance /
        distanceTotal;

      const ambiguity =
        1 -
        Math.abs(alpha - 127.5) /
        127.5;

      const effectiveBlend =
        preset.blend * ambiguity;

      const refinedAlpha = Math.round(
        alpha * (1 - effectiveBlend) +
        sourceAlpha * effectiveBlend,
      );

      if (refinedAlpha === alpha) {
        continue;
      }

      output[rgbaIndex + 3] = refinedAlpha;
      refinedPixels += 1;
    }
  }

  return {
    output,
    uncertainPixels,
    refinedPixels,
  };
};

const scoreOutput = async (
  outputDirectory: string,
  reportPath: string,
) => {
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
      `Matte refinement scorer exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }

  return Schema.decodeUnknownSync(
    QualityReportSchema,
  )(
    JSON.parse(
      await readFile(reportPath, "utf8"),
    ),
  ).aggregate;
};

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

  const timings: RefinementCaseTiming[] = [];

  for (const benchmarkCase of manifest.cases) {
    const outputName =
      safeOutputName(benchmarkCase.id);

    const baselinePath = join(
      baselineRoot,
      outputName,
    );

    const sourcePath = resolve(
      manifestRoot,
      benchmarkCase.input,
    );

    const [baselineRaster, sourceRaster] =
      await Promise.all([
        sharp(baselinePath)
          .ensureAlpha()
          .raw()
          .toBuffer({
            resolveWithObject: true,
          }),
        sharp(sourcePath)
          .ensureAlpha()
          .raw()
          .toBuffer({
            resolveWithObject: true,
          }),
      ]);

    if (
      baselineRaster.info.width !==
        sourceRaster.info.width ||
      baselineRaster.info.height !==
        sourceRaster.info.height ||
      baselineRaster.info.channels !== 4 ||
      sourceRaster.info.channels !== 4
    ) {
      throw new Error(
        `Source and baseline dimensions differ for ${benchmarkCase.id}.`,
      );
    }

    const started = performance.now();

    const refined = refineAlpha(
      sourceRaster.data,
      baselineRaster.data,
      baselineRaster.info.width,
      baselineRaster.info.height,
      preset,
    );

    const milliseconds =
      performance.now() - started;

    await sharp(
      refined.output,
      {
        raw: {
          width: baselineRaster.info.width,
          height: baselineRaster.info.height,
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
      uncertainPixels:
        refined.uncertainPixels,
      refinedPixels:
        refined.refinedPixels,
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

  const totalMilliseconds = timings.reduce(
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
    delta: {
      mae:
        quality.mae -
        baselineQuality.mae,
      mse:
        quality.mse -
        baselineQuality.mse,
      iou:
        quality.iou -
        baselineQuality.iou,
      f1:
        quality.f1 -
        baselineQuality.f1,
    },
  });
}

const report = {
  schemaVersion: 1,
  manifest: manifestPath,
  baselineOutputDirectory: baselineRoot,
  baselineQuality,
  variants: variantReports,
};

const reportPath = join(
  outputRoot,
  "matte-refinement.json",
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
      baseline: baselineQuality,
      variants: variantReports.map(
        (variant) => ({
          id: variant.preset.id,
          timing:
            variant.timing,
          quality:
            variant.quality,
          delta:
            variant.delta,
        }),
      ),
    },
    null,
    2,
  ),
);

console.log(
  `Matte refinement report: ${reportPath}`,
);
