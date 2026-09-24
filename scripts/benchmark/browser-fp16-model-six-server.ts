import {
  Effect,
  Schema,
} from "effect";
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

import {
  MODEL_SHA256,
  MODEL_SIZE_BYTES,
} from "../../src/shared/model-config";
import { inspectModelFile } from "../../src/shared/model-file";
import { ORT_WEBGPU_WASM_PUBLIC_PATH } from "../../src/shared/ort-assets";

const FP16_MODEL_SHA256 =
  "37d4035765b97a0323729fdee787d16eb7238c39c467316e887c5292792f3e33";

const FP16_MODEL_SIZE_BYTES =
  98_572_669;

const FP32_MODEL_PATH =
  "/models/fp32.onnx";

const FP16_MODEL_PATH =
  "/models/fp16.onnx";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const BenchmarkManifestSchema = Schema.Struct({
  cases: Schema.Array(
    BenchmarkCaseSchema,
  ),
});

const ModeSchema = Schema.Literal(
  "fp32",
  "fp16",
);

const SequenceSchema = Schema.Literal(
  "fp32-first",
  "fp16-first",
);

const DirectionSchema = Schema.Literal(
  "forward",
  "reverse",
);

const BlockSchema = Schema.Struct({
  index: Schema.Number,
  sequence: SequenceSchema,
  direction: DirectionSchema,
  mode: ModeSchema,
  modelPath: Schema.String,
  caseIndexes: Schema.Array(
    Schema.Number,
  ),
});

const ActivationSchema = Schema.Struct({
  launchToken: Schema.String,
  blockIndex: Schema.Number,
  primeOnly: Schema.Boolean,
});


const RemovalTimingsSchema = Schema.Struct({
  decodeMs: Schema.Number,
  runtimeMs: Schema.Number,
  modelDownloadMs: Schema.Number,
  sessionInitMs: Schema.Number,
  preprocessMs: Schema.Number,
  inputUploadMs: Schema.Number,
  inferenceMs: Schema.Number,
  outputReadbackMs: Schema.Number,
  matteMs: Schema.Number,
  compositeMs: Schema.Number,
  exportMs: Schema.Number,
  totalMs: Schema.Number,
  sessionReused: Schema.Boolean,
});

const RunRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  blockIndex: Schema.Number,
  sequence: SequenceSchema,
  direction: DirectionSchema,
  mode: ModeSchema,
  caseId: Schema.String,
  run: Schema.Number,
  timings: RemovalTimingsSchema,
});

const PrimeRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  blockIndex: Schema.Number,
  sequence: SequenceSchema,
  direction: DirectionSchema,
  mode: ModeSchema,
  caseId: Schema.String,
  timings: RemovalTimingsSchema,
});

const FailureRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  blockIndex: Schema.Number,
  sequence: SequenceSchema,
  direction: DirectionSchema,
  mode: ModeSchema,
  caseId: Schema.String,
  run: Schema.Union(
    Schema.Number,
    Schema.Literal("prime"),
  ),
  elapsedMs: Schema.Number,
  message: Schema.String,
  stack: Schema.String,
});

const BlockReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  userAgent: Schema.String,
  block: BlockSchema,
  prime: PrimeRecordSchema,
  runs: Schema.Array(
    RunRecordSchema,
  ),
});

type Sequence =
  Schema.Schema.Type<
    typeof SequenceSchema
  >;

type Direction =
  Schema.Schema.Type<
    typeof DirectionSchema
  >;

type Block =
  Schema.Schema.Type<
    typeof BlockSchema
  >;

type RunRecord =
  Schema.Schema.Type<
    typeof RunRecordSchema
  >;

type PrimeRecord =
  Schema.Schema.Type<
    typeof PrimeRecordSchema
  >;

type FailureRecord =
  Schema.Schema.Type<
    typeof FailureRecordSchema
  >;

type BlockReport =
  Schema.Schema.Type<
    typeof BlockReportSchema
  >;

type TimingSummary = {
  readonly inferenceMedianMs: number;
  readonly outputReadbackMedianMs: number;
  readonly totalMedianMs: number;
};

type ModeComparison = {
  readonly fp32: TimingSummary;
  readonly fp16: TimingSummary;
  readonly inferenceChangePercent: number;
  readonly totalChangePercent: number;
};

type TrialSummary = {
  readonly trial: number;
  readonly sequence: Sequence;
  readonly direction: Direction;
  readonly fp32Block: number;
  readonly fp16Block: number;
  readonly comparison: ModeComparison;
};

type PerCaseTiming = ModeComparison & {
  readonly id: string;
};

type MetricTotals = {
  absoluteError: number;
  squaredError: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  pixels: number;
};

type QualityMetrics = {
  readonly pixels: number;
  readonly mae: number;
  readonly mse: number;
  readonly iou: number;
  readonly f1: number;
};

type QualityComparison = {
  readonly fp32: QualityMetrics;
  readonly fp16: QualityMetrics;
  readonly maeChange: number;
  readonly mseChange: number;
  readonly iouChange: number;
  readonly f1Change: number;
};

type PerCaseQuality = QualityComparison & {
  readonly id: string;
};

type PixelComparison = {
  readonly left: string;
  readonly right: string;
  readonly width: number;
  readonly height: number;
  readonly values: number;
  readonly pixels: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
  readonly alphaDifferences: number;
  readonly meanAbsoluteAlphaByteDifference: number;
  readonly maxAbsoluteAlphaByteDifference: number;
  readonly pixelsWithAnyDifference: number;
  readonly pixelsWithAlphaDifference: number;
  readonly pixelsWithRgbDifferenceAndEqualAlpha: number;
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly runsPerCase: number;
  readonly cases: number;
  readonly fp32Model: {
    readonly sizeBytes: number;
    readonly sha256: string;
  };
  readonly fp16Model: {
    readonly sizeBytes: number;
    readonly sha256: string;
  };
  readonly blocks: readonly Block[];
  readonly aggregate: ModeComparison;
  readonly bySequence: Readonly<
    Record<
      Sequence,
      ModeComparison
    >
  >;
  readonly byDirection: Readonly<
    Record<
      Direction,
      ModeComparison
    >
  >;
  readonly byPosition: {
    readonly first: ModeComparison;
    readonly second: ModeComparison;
  };
  readonly trials: readonly TrialSummary[];
  readonly perCase: readonly PerCaseTiming[];
  readonly quality: {
    readonly aggregate: QualityComparison;
    readonly perCase: readonly PerCaseQuality[];
  };
  readonly parity: {
    readonly sameModelRgbaExact: boolean;
    readonly sameModelAlphaExact: boolean;
    readonly paired: readonly PixelComparison[];
    readonly withinBlock: readonly PixelComparison[];
    readonly crossContext: readonly PixelComparison[];
  };
  readonly reports: readonly BlockReport[];
};

type PersistedRecord =
  | RunRecord
  | PrimeRecord
  | FailureRecord
  | BlockReport
  | FinalReport;

type RgbaRaster = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

type AlphaRaster = {
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array;
};

const usage =
  "Usage: bun run benchmark:browser-fp16-model:six -- <manifest.json> <output-dir> <fp32-model.onnx> <fp16-model.onnx> [runs-per-case] [timeout-ms] [port] [session-token]";

const [
  manifestArgument,
  outputArgument,
  fp32ModelArgument,
  fp16ModelArgument,
  runsArgument = "3",
  timeoutArgument = "60000",
  portArgument = "4184",
  sessionArgument,
] = process.argv.slice(
  2,
);

if (
  manifestArgument ===
    undefined ||
  outputArgument ===
    undefined ||
  fp32ModelArgument ===
    undefined ||
  fp16ModelArgument ===
    undefined
) {
  throw new Error(
    usage,
  );
}

const manifestPath =
  resolve(
    manifestArgument,
  );

const manifestRoot =
  dirname(
    manifestPath,
  );

const outputRoot =
  resolve(
    outputArgument,
  );

const outputsRoot =
  join(
    outputRoot,
    "outputs",
  );

const runsRoot =
  join(
    outputRoot,
    "runs",
  );

const blocksRoot =
  join(
    outputRoot,
    "blocks",
  );

const fp32ModelPath =
  resolve(
    fp32ModelArgument,
  );

const fp16ModelPath =
  resolve(
    fp16ModelArgument,
  );

const runsPerCase =
  Number.parseInt(
    runsArgument,
    10,
  );

if (
  !Number.isInteger(
    runsPerCase,
  ) ||
  runsPerCase <
    3
) {
  throw new Error(
    `Runs per case must be an integer >= 3, received "${runsArgument}".`,
  );
}

const timeoutMs =
  Number.parseInt(
    timeoutArgument,
    10,
  );

if (
  !Number.isInteger(
    timeoutMs,
  ) ||
  timeoutMs <
    1
) {
  throw new Error(
    `Timeout must be a positive integer, received "${timeoutArgument}".`,
  );
}

const port =
  Number.parseInt(
    portArgument,
    10,
  );

if (
  !Number.isInteger(
    port,
  ) ||
  port <
    1
) {
  throw new Error(
    `Port must be a positive integer, received "${portArgument}".`,
  );
}

const sessionToken =
  sessionArgument ??
  `manual-${crypto.randomUUID()}`;

if (
  sessionToken.length <
  8
) {
  throw new Error(
    "FP16 six-image benchmark session token is too short.",
  );
}

const encodedSessionToken =
  encodeURIComponent(
    sessionToken,
  );

const sessionPath =
  `/session/${encodedSessionToken}`;

const manifest =
  Schema.decodeUnknownSync(
    BenchmarkManifestSchema,
  )(
    JSON.parse(
      await readFile(
        manifestPath,
        "utf8",
      ),
    ),
  );

if (
  manifest.cases.length !==
  6
) {
  throw new Error(
    `The FP16 six-image gate requires exactly 6 cases, received ${manifest.cases.length}.`,
  );
}

const forwardIndexes =
  manifest.cases.map(
    (_, index) =>
      index,
  );

const reverseIndexes =
  [...forwardIndexes].reverse();

const blocks:
  readonly Block[] = [
    {
      index: 0,
      sequence:
        "fp32-first",
      direction:
        "forward",
      mode:
        "fp32",
      modelPath:
        FP32_MODEL_PATH,
      caseIndexes:
        forwardIndexes,
    },
    {
      index: 1,
      sequence:
        "fp32-first",
      direction:
        "forward",
      mode:
        "fp16",
      modelPath:
        FP16_MODEL_PATH,
      caseIndexes:
        forwardIndexes,
    },
    {
      index: 2,
      sequence:
        "fp16-first",
      direction:
        "reverse",
      mode:
        "fp16",
      modelPath:
        FP16_MODEL_PATH,
      caseIndexes:
        reverseIndexes,
    },
    {
      index: 3,
      sequence:
        "fp16-first",
      direction:
        "reverse",
      mode:
        "fp32",
      modelPath:
        FP32_MODEL_PATH,
      caseIndexes:
        reverseIndexes,
    },
    {
      index: 4,
      sequence:
        "fp16-first",
      direction:
        "forward",
      mode:
        "fp16",
      modelPath:
        FP16_MODEL_PATH,
      caseIndexes:
        forwardIndexes,
    },
    {
      index: 5,
      sequence:
        "fp16-first",
      direction:
        "forward",
      mode:
        "fp32",
      modelPath:
        FP32_MODEL_PATH,
      caseIndexes:
        forwardIndexes,
    },
    {
      index: 6,
      sequence:
        "fp32-first",
      direction:
        "reverse",
      mode:
        "fp32",
      modelPath:
        FP32_MODEL_PATH,
      caseIndexes:
        reverseIndexes,
    },
    {
      index: 7,
      sequence:
        "fp32-first",
      direction:
        "reverse",
      mode:
        "fp16",
      modelPath:
        FP16_MODEL_PATH,
      caseIndexes:
        reverseIndexes,
    },
  ];

const trials = [
  {
    trial: 1,
    sequence:
      "fp32-first" as const,
    direction:
      "forward" as const,
    fp32Block: 0,
    fp16Block: 1,
  },
  {
    trial: 2,
    sequence:
      "fp16-first" as const,
    direction:
      "reverse" as const,
    fp32Block: 3,
    fp16Block: 2,
  },
  {
    trial: 3,
    sequence:
      "fp16-first" as const,
    direction:
      "forward" as const,
    fp32Block: 5,
    fp16Block: 4,
  },
  {
    trial: 4,
    sequence:
      "fp32-first" as const,
    direction:
      "reverse" as const,
    fp32Block: 6,
    fp16Block: 7,
  },
] as const;

await Promise.all([
  mkdir(
    outputRoot,
    {
      recursive: true,
    },
  ),
  mkdir(
    outputsRoot,
    {
      recursive: true,
    },
  ),
  mkdir(
    runsRoot,
    {
      recursive: true,
    },
  ),
  mkdir(
    blocksRoot,
    {
      recursive: true,
    },
  ),
  ...blocks.map(
    (block) =>
      mkdir(
        join(
          outputsRoot,
          `block-${block.index}`,
        ),
        {
          recursive: true,
        },
      ),
  ),
]);

const build =
  await Bun.build({
    entrypoints: [
      join(
        import.meta.dir,
        "browser-fp16-model-six-client.ts",
      ),
    ],
    target:
      "browser",
    format:
      "esm",
    minify:
      false,
    sourcemap:
      "inline",
  });

if (
  !build.success
) {
  throw new Error(
    `Could not build FP16 six-image client.\n${build.logs
      .map(
        (log) =>
          log.message,
      )
      .join("\n")}`,
  );
}

const clientOutput =
  build.outputs.at(
    0,
  );

if (
  clientOutput ===
    undefined
) {
  throw new Error(
    "FP16 six-image client produced no bundle.",
  );
}

const clientSource =
  await clientOutput.text();

const runtimePath =
  resolve(
    import.meta.dir,
    "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
  );

const runtimeFile =
  Bun.file(
    runtimePath,
  );

if (
  !(await runtimeFile.exists())
) {
  throw new Error(
    `ONNX Runtime WebGPU runtime is missing at ${runtimePath}.`,
  );
}

if (
  process.env
    .BGCUT_BROWSER_FP16_MODEL_SIX_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser FP16 six-image bundle check passed.",
  );

  process.exit(
    0,
  );
}

const sessionCheckOnly =
  process.env
    .BGCUT_BROWSER_FP16_MODEL_SIX_SESSION_CHECK ===
  "1";

const [
  fp32Fingerprint,
  fp16Fingerprint,
] =
  sessionCheckOnly
    ? [
        {
          sizeBytes:
            MODEL_SIZE_BYTES,
          sha256:
            MODEL_SHA256,
        },
        {
          sizeBytes:
            FP16_MODEL_SIZE_BYTES,
          sha256:
            FP16_MODEL_SHA256,
        },
      ]
    : await Promise.all([
        Effect.runPromise(
          inspectModelFile(
            fp32ModelPath,
          ),
        ),
        Effect.runPromise(
          inspectModelFile(
            fp16ModelPath,
          ),
        ),
      ]);

if (
  !sessionCheckOnly &&
  (
    fp32Fingerprint
      ?.sizeBytes !==
      MODEL_SIZE_BYTES ||
    fp32Fingerprint.sha256 !==
      MODEL_SHA256
  )
) {
  throw new Error(
    "FP32 benchmark model does not match the validated production artifact.",
  );
}

if (
  !sessionCheckOnly &&
  (
    fp16Fingerprint
      ?.sizeBytes !==
      FP16_MODEL_SIZE_BYTES ||
    fp16Fingerprint.sha256 !==
      FP16_MODEL_SHA256
  )
) {
  throw new Error(
    "FP16 benchmark model does not match the generated candidate artifact.",
  );
}

const fp32ModelFile =
  Bun.file(
    fp32ModelPath,
  );

const fp16ModelFile =
  Bun.file(
    fp16ModelPath,
  );

const reports =
  new Map<
    number,
    BlockReport
  >();

let activeLaunch:
  | {
      readonly token: string;
      readonly blockIndex: number;
      readonly primeOnly: boolean;
    }
  | undefined;

const safeOutputName = (
  id: string,
): string =>
  id
    .replaceAll(
      "/",
      "__",
    )
    .replaceAll(
      "\\",
      "__",
    );

const outputPath = (
  blockIndex: number,
  caseIndex: number,
  run: number,
): string => {
  const benchmarkCase =
    manifest.cases.at(
      caseIndex,
    );

  if (
    benchmarkCase ===
      undefined
  ) {
    throw new Error(
      `Unknown benchmark case ${caseIndex}.`,
    );
  }

  return join(
    outputsRoot,
    `block-${blockIndex}`,
    `${safeOutputName(
      benchmarkCase.id,
    )}-run-${run}.png`,
  );
};

const writeJson = async (
  path: string,
  value: PersistedRecord,
): Promise<void> => {
  await writeFile(
    path,
    `${JSON.stringify(
      value,
      null,
      2,
    )}\n`,
  );
};

const median = (
  values:
    readonly number[],
): number => {
  if (
    values.length ===
    0
  ) {
    throw new Error(
      "Median requires at least one value.",
    );
  }

  const sorted =
    [...values].sort(
      (left, right) =>
        left -
        right,
    );

  const middle =
    Math.floor(
      sorted.length /
      2,
    );

  return sorted.length %
      2 ===
    1
    ? sorted[
        middle
      ]
    : (
        sorted[
          middle -
          1
        ] +
        sorted[
          middle
        ]
      ) /
        2;
};

const summarize = (
  records:
    readonly RunRecord[],
): TimingSummary => ({
  inferenceMedianMs:
    median(
      records.map(
        (record) =>
          record.timings
            .inferenceMs,
      ),
    ),
  outputReadbackMedianMs:
    median(
      records.map(
        (record) =>
          record.timings
            .outputReadbackMs,
      ),
    ),
  totalMedianMs:
    median(
      records.map(
        (record) =>
          record.timings
            .totalMs,
      ),
    ),
});

const percentChange = (
  baseline: number,
  candidate: number,
): number =>
  (
    (
      candidate -
      baseline
    ) /
    baseline
  ) *
  100;

const compareTimings = (
  fp32Runs:
    readonly RunRecord[],
  fp16Runs:
    readonly RunRecord[],
): ModeComparison => {
  const fp32 =
    summarize(
      fp32Runs,
    );

  const fp16 =
    summarize(
      fp16Runs,
    );

  return {
    fp32,
    fp16,
    inferenceChangePercent:
      percentChange(
        fp32
          .inferenceMedianMs,
        fp16
          .inferenceMedianMs,
      ),
    totalChangePercent:
      percentChange(
        fp32
          .totalMedianMs,
        fp16
          .totalMedianMs,
      ),
  };
};

const emptyTotals =
  (): MetricTotals => ({
    absoluteError: 0,
    squaredError: 0,
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    pixels: 0,
  });

const metricsFromTotals = (
  totals: MetricTotals,
): QualityMetrics => {
  const union =
    totals.truePositive +
    totals.falsePositive +
    totals.falseNegative;

  const f1Denominator =
    2 *
      totals.truePositive +
    totals.falsePositive +
    totals.falseNegative;

  return {
    pixels:
      totals.pixels,
    mae:
      totals.absoluteError /
      totals.pixels,
    mse:
      totals.squaredError /
      totals.pixels,
    iou:
      union ===
        0
        ? 1
        : totals.truePositive /
          union,
    f1:
      f1Denominator ===
        0
        ? 1
        : (
            2 *
            totals.truePositive
          ) /
          f1Denominator,
  };
};

const addAlphaPixels = (
  totals: MetricTotals,
  prediction:
    Uint8Array,
  expected:
    Uint8Array,
): void => {
  for (
    let pixel = 0;
    pixel <
    prediction.length;
    pixel += 1
  ) {
    const predicted =
      prediction[
        pixel
      ];

    const reference =
      expected[
        pixel
      ];

    const difference =
      Math.abs(
        predicted -
        reference,
      ) /
      255;

    totals.absoluteError +=
      difference;

    totals.squaredError +=
      difference *
      difference;

    totals.pixels +=
      1;

    const predictedForeground =
      predicted >=
      128;

    const expectedForeground =
      reference >=
      128;

    if (
      predictedForeground &&
      expectedForeground
    ) {
      totals.truePositive +=
        1;
    } else if (
      predictedForeground
    ) {
      totals.falsePositive +=
        1;
    } else if (
      expectedForeground
    ) {
      totals.falseNegative +=
        1;
    }
  }
};

const readAlpha = async (
  path: string,
): Promise<AlphaRaster> => {
  const result =
    await sharp(
      path,
    )
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject:
          true,
      });

  if (
    result.info.channels !==
    4
  ) {
    throw new Error(
      `Expected RGBA output at ${path}.`,
    );
  }

  const values =
    new Uint8Array(
      result.info.width *
      result.info.height,
    );

  for (
    let pixel = 0;
    pixel <
    values.length;
    pixel += 1
  ) {
    values[
      pixel
    ] =
      result.data[
        pixel *
          4 +
        3
      ];
  }

  return {
    width:
      result.info.width,
    height:
      result.info.height,
    values,
  };
};

const readMask = async (
  caseIndex: number,
): Promise<AlphaRaster> => {
  const benchmarkCase =
    manifest.cases.at(
      caseIndex,
    );

  if (
    benchmarkCase ===
      undefined
  ) {
    throw new Error(
      `Unknown benchmark mask ${caseIndex}.`,
    );
  }

  const result =
    await sharp(
      resolve(
        manifestRoot,
        benchmarkCase.mask,
      ),
    )
      .greyscale()
      .raw()
      .toBuffer({
        resolveWithObject:
          true,
      });

  const values =
    new Uint8Array(
      result.info.width *
      result.info.height,
    );

  for (
    let pixel = 0;
    pixel <
    values.length;
    pixel += 1
  ) {
    values[
      pixel
    ] =
      result.data[
        pixel *
        result.info.channels
      ];
  }

  return {
    width:
      result.info.width,
    height:
      result.info.height,
    values,
  };
};

const scoreOutput = async (
  blockIndex: number,
  caseIndex: number,
  run: number,
): Promise<{
  readonly totals:
    MetricTotals;
  readonly metrics:
    QualityMetrics;
}> => {
  const [
    prediction,
    expected,
  ] =
    await Promise.all([
      readAlpha(
        outputPath(
          blockIndex,
          caseIndex,
          run,
        ),
      ),
      readMask(
        caseIndex,
      ),
    ]);

  if (
    prediction.width !==
      expected.width ||
    prediction.height !==
      expected.height
  ) {
    throw new Error(
      `Output dimensions differ from the reference mask for case ${caseIndex}.`,
    );
  }

  const totals =
    emptyTotals();

  addAlphaPixels(
    totals,
    prediction.values,
    expected.values,
  );

  return {
    totals,
    metrics:
      metricsFromTotals(
        totals,
      ),
  };
};

const addTotals = (
  target: MetricTotals,
  source: MetricTotals,
): void => {
  target.absoluteError +=
    source.absoluteError;

  target.squaredError +=
    source.squaredError;

  target.truePositive +=
    source.truePositive;

  target.falsePositive +=
    source.falsePositive;

  target.falseNegative +=
    source.falseNegative;

  target.pixels +=
    source.pixels;
};

const compareQuality = (
  fp32: QualityMetrics,
  fp16: QualityMetrics,
): QualityComparison => ({
  fp32,
  fp16,
  maeChange:
    fp16.mae -
    fp32.mae,
  mseChange:
    fp16.mse -
    fp32.mse,
  iouChange:
    fp16.iou -
    fp32.iou,
  f1Change:
    fp16.f1 -
    fp32.f1,
});

const scoreCanonicalQuality =
  async (): Promise<{
    readonly aggregate:
      QualityComparison;
    readonly perCase:
      readonly PerCaseQuality[];
  }> => {
    const fp32Totals =
      emptyTotals();

    const fp16Totals =
      emptyTotals();

    const perCase:
      PerCaseQuality[] = [];

    for (
      let caseIndex = 0;
      caseIndex <
      manifest.cases.length;
      caseIndex += 1
    ) {
      const benchmarkCase =
        manifest.cases.at(
          caseIndex,
        );

      if (
        benchmarkCase ===
          undefined
      ) {
        throw new Error(
          `Unknown benchmark case ${caseIndex}.`,
        );
      }

      const [
        fp32,
        fp16,
      ] =
        await Promise.all([
          scoreOutput(
            0,
            caseIndex,
            1,
          ),
          scoreOutput(
            1,
            caseIndex,
            1,
          ),
        ]);

      addTotals(
        fp32Totals,
        fp32.totals,
      );

      addTotals(
        fp16Totals,
        fp16.totals,
      );

      perCase.push({
        id:
          benchmarkCase.id,
        ...compareQuality(
          fp32.metrics,
          fp16.metrics,
        ),
      });
    }

    return {
      aggregate:
        compareQuality(
          metricsFromTotals(
            fp32Totals,
          ),
          metricsFromTotals(
            fp16Totals,
          ),
        ),
      perCase,
    };
  };

const readRgba = async (
  blockIndex: number,
  caseIndex: number,
  run: number,
): Promise<RgbaRaster> => {
  const result =
    await sharp(
      outputPath(
        blockIndex,
        caseIndex,
        run,
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject:
          true,
      });

  if (
    result.info.channels !==
    4
  ) {
    throw new Error(
      `Expected RGBA output for block ${blockIndex}, case ${caseIndex}, run ${run}.`,
    );
  }

  return {
    width:
      result.info.width,
    height:
      result.info.height,
    data:
      new Uint8Array(
        result.data,
      ),
  };
};

const comparePixels = async (
  leftBlock: number,
  leftCase: number,
  leftRun: number,
  rightBlock: number,
  rightCase: number,
  rightRun: number,
): Promise<PixelComparison> => {
  const [
    left,
    right,
  ] =
    await Promise.all([
      readRgba(
        leftBlock,
        leftCase,
        leftRun,
      ),
      readRgba(
        rightBlock,
        rightCase,
        rightRun,
      ),
    ]);

  if (
    left.width !==
      right.width ||
    left.height !==
      right.height ||
    left.data.length !==
      right.data.length
  ) {
    throw new Error(
      `Output dimensions differ between block ${leftBlock}/case ${leftCase}/run ${leftRun} and block ${rightBlock}/case ${rightCase}/run ${rightRun}.`,
    );
  }

  let absolute = 0;
  let maximum = 0;
  let differing = 0;
  let alphaAbsolute = 0;
  let alphaMaximum = 0;
  let alphaDifferences = 0;
  let pixelsWithAnyDifference = 0;
  let pixelsWithAlphaDifference = 0;
  let pixelsWithRgbDifferenceAndEqualAlpha = 0;

  for (
    let pixel = 0;
    pixel <
    left.data.length /
      4;
    pixel += 1
  ) {
    const offset =
      pixel *
      4;

    let pixelDiffers =
      false;

    let rgbDiffers =
      false;

    for (
      let channel = 0;
      channel <
      4;
      channel += 1
    ) {
      const index =
        offset +
        channel;

      const difference =
        Math.abs(
          left.data[
            index
          ] -
          right.data[
            index
          ],
        );

      absolute +=
        difference;

      maximum =
        Math.max(
          maximum,
          difference,
        );

      if (
        difference !==
        0
      ) {
        differing +=
          1;

        pixelDiffers =
          true;

        if (
          channel <
          3
        ) {
          rgbDiffers =
            true;
        } else {
          alphaAbsolute +=
            difference;

          alphaMaximum =
            Math.max(
              alphaMaximum,
              difference,
            );

          alphaDifferences +=
            1;
        }
      }
    }

    const alphaDiffers =
      left.data[
        offset +
        3
      ] !==
      right.data[
        offset +
        3
      ];

    if (
      pixelDiffers
    ) {
      pixelsWithAnyDifference +=
        1;
    }

    if (
      alphaDiffers
    ) {
      pixelsWithAlphaDifference +=
        1;
    }

    if (
      rgbDiffers &&
      !alphaDiffers
    ) {
      pixelsWithRgbDifferenceAndEqualAlpha +=
        1;
    }
  }

  const pixels =
    left.data.length /
    4;

  return {
    left:
      `block-${leftBlock}-case-${leftCase}-run-${leftRun}`,
    right:
      `block-${rightBlock}-case-${rightCase}-run-${rightRun}`,
    width:
      left.width,
    height:
      left.height,
    values:
      left.data.length,
    pixels,
    differingValues:
      differing,
    differingValueFraction:
      differing /
      left.data.length,
    meanAbsoluteByteDifference:
      absolute /
      left.data.length,
    maxAbsoluteByteDifference:
      maximum,
    alphaDifferences,
    meanAbsoluteAlphaByteDifference:
      alphaAbsolute /
      pixels,
    maxAbsoluteAlphaByteDifference:
      alphaMaximum,
    pixelsWithAnyDifference,
    pixelsWithAlphaDifference,
    pixelsWithRgbDifferenceAndEqualAlpha,
  };
};

const getReport = (
  blockIndex: number,
): BlockReport => {
  const report =
    reports.get(
      blockIndex,
    );

  if (
    report ===
      undefined
  ) {
    throw new Error(
      `Missing report for block ${blockIndex}.`,
    );
  }

  return report;
};

const runsForBlocks = (
  blockIndexes:
    readonly number[],
): readonly RunRecord[] =>
  blockIndexes.flatMap(
    (blockIndex) =>
      getReport(
        blockIndex,
      ).runs,
  );

const compareRunPairs = async (
  leftBlock: number,
  rightBlock: number,
): Promise<
  readonly PixelComparison[]
> => {
  const comparisons:
    PixelComparison[] = [];

  for (
    let caseIndex = 0;
    caseIndex <
    manifest.cases.length;
    caseIndex += 1
  ) {
    for (
      let run = 1;
      run <=
      runsPerCase;
      run += 1
    ) {
      comparisons.push(
        await comparePixels(
          leftBlock,
          caseIndex,
          run,
          rightBlock,
          caseIndex,
          run,
        ),
      );
    }
  }

  return comparisons;
};

const compareWithinBlocks =
  async (): Promise<
    readonly PixelComparison[]
  > => {
    const comparisons:
      PixelComparison[] = [];

    for (
      const block of
      blocks
    ) {
      for (
        let caseIndex = 0;
        caseIndex <
        manifest.cases.length;
        caseIndex += 1
      ) {
        for (
          let leftRun = 1;
          leftRun <=
          runsPerCase;
          leftRun += 1
        ) {
          for (
            let rightRun =
              leftRun +
              1;
            rightRun <=
            runsPerCase;
            rightRun += 1
          ) {
            comparisons.push(
              await comparePixels(
                block.index,
                caseIndex,
                leftRun,
                block.index,
                caseIndex,
                rightRun,
              ),
            );
          }
        }
      }
    }

    return comparisons;
  };

const compareCrossContext =
  async (): Promise<
    readonly PixelComparison[]
  > => {
    const comparisons:
      PixelComparison[] = [];

    const modeBlocks = {
      fp32: [
        0,
        3,
        5,
        6,
      ],
      fp16: [
        1,
        2,
        4,
        7,
      ],
    } as const;

    for (
      const selected of [
        modeBlocks.fp32,
        modeBlocks.fp16,
      ]
    ) {
      const reference =
        selected[
          0
        ];

      for (
        const candidate of
        selected.slice(
          1,
        )
      ) {
        for (
          let caseIndex = 0;
          caseIndex <
          manifest.cases.length;
          caseIndex += 1
        ) {
          for (
            let run = 1;
            run <=
            runsPerCase;
            run += 1
          ) {
            comparisons.push(
              await comparePixels(
                reference,
                caseIndex,
                run,
                candidate,
                caseIndex,
                run,
              ),
            );
          }
        }
      }
    }

    return comparisons;
  };

const finalize =
  async (): Promise<
    FinalReport
  > => {
    const allReports =
      blocks.map(
        (block) =>
          getReport(
            block.index,
          ),
      );

    const fp32Blocks =
      [
        0,
        3,
        5,
        6,
      ] as const;

    const fp16Blocks =
      [
        1,
        2,
        4,
        7,
      ] as const;

    const sequenceBlocks = {
      "fp32-first": {
        fp32: [
          0,
          6,
        ],
        fp16: [
          1,
          7,
        ],
      },
      "fp16-first": {
        fp32: [
          3,
          5,
        ],
        fp16: [
          2,
          4,
        ],
      },
    } as const;

    const directionBlocks = {
      forward: {
        fp32: [
          0,
          5,
        ],
        fp16: [
          1,
          4,
        ],
      },
      reverse: {
        fp32: [
          3,
          6,
        ],
        fp16: [
          2,
          7,
        ],
      },
    } as const;

    const fp32Runs =
      runsForBlocks(
        fp32Blocks,
      );

    const fp16Runs =
      runsForBlocks(
        fp16Blocks,
      );

    const perCase =
      manifest.cases.map(
        (benchmarkCase) => {
          const fp32 =
            fp32Runs.filter(
              (record) =>
                record.caseId ===
                benchmarkCase.id,
            );

          const fp16 =
            fp16Runs.filter(
              (record) =>
                record.caseId ===
                benchmarkCase.id,
            );

          return {
            id:
              benchmarkCase.id,
            ...compareTimings(
              fp32,
              fp16,
            ),
          };
        },
      );

    const trialSummaries:
      TrialSummary[] =
      trials.map(
        (trial) => ({
          trial:
            trial.trial,
          sequence:
            trial.sequence,
          direction:
            trial.direction,
          fp32Block:
            trial.fp32Block,
          fp16Block:
            trial.fp16Block,
          comparison:
            compareTimings(
              runsForBlocks([
                trial.fp32Block,
              ]),
              runsForBlocks([
                trial.fp16Block,
              ]),
            ),
        }),
      );

    const quality =
      await scoreCanonicalQuality();

    const paired =
      (
        await Promise.all(
          trials.map(
            (trial) =>
              compareRunPairs(
                trial.fp32Block,
                trial.fp16Block,
              ),
          ),
        )
      ).flat();

    const withinBlock =
      await compareWithinBlocks();

    const crossContext =
      await compareCrossContext();

    const sameModel =
      [
        ...withinBlock,
        ...crossContext,
      ];

    const report:
      FinalReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        userAgent:
          allReports.at(
            0,
          )?.userAgent ??
          "",
        runsPerCase,
        cases:
          manifest.cases.length,
        fp32Model: {
          sizeBytes:
            fp32Fingerprint.sizeBytes,
          sha256:
            fp32Fingerprint.sha256,
        },
        fp16Model: {
          sizeBytes:
            fp16Fingerprint.sizeBytes,
          sha256:
            fp16Fingerprint.sha256,
        },
        blocks,
        aggregate:
          compareTimings(
            fp32Runs,
            fp16Runs,
          ),
        bySequence: {
          "fp32-first":
            compareTimings(
              runsForBlocks(
                sequenceBlocks[
                  "fp32-first"
                ].fp32,
              ),
              runsForBlocks(
                sequenceBlocks[
                  "fp32-first"
                ].fp16,
              ),
            ),
          "fp16-first":
            compareTimings(
              runsForBlocks(
                sequenceBlocks[
                  "fp16-first"
                ].fp32,
              ),
              runsForBlocks(
                sequenceBlocks[
                  "fp16-first"
                ].fp16,
              ),
            ),
        },
        byDirection: {
          forward:
            compareTimings(
              runsForBlocks(
                directionBlocks
                  .forward
                  .fp32,
              ),
              runsForBlocks(
                directionBlocks
                  .forward
                  .fp16,
              ),
            ),
          reverse:
            compareTimings(
              runsForBlocks(
                directionBlocks
                  .reverse
                  .fp32,
              ),
              runsForBlocks(
                directionBlocks
                  .reverse
                  .fp16,
              ),
            ),
        },
        byPosition: {
          first:
            compareTimings(
              runsForBlocks([
                0,
                6,
              ]),
              runsForBlocks([
                2,
                4,
              ]),
            ),
          second:
            compareTimings(
              runsForBlocks([
                3,
                5,
              ]),
              runsForBlocks([
                1,
                7,
              ]),
            ),
        },
        trials:
          trialSummaries,
        perCase,
        quality: {
          aggregate:
            quality.aggregate,
          perCase:
            quality.perCase,
        },
        parity: {
          sameModelRgbaExact:
            sameModel.every(
              (comparison) =>
                comparison.differingValues ===
                0,
            ),
          sameModelAlphaExact:
            sameModel.every(
              (comparison) =>
                comparison.alphaDifferences ===
                0,
            ),
          paired,
          withinBlock,
          crossContext,
        },
        reports:
          allReports,
      };

    await writeJson(
      join(
        outputRoot,
        "browser-fp16-model-six.json",
      ),
      report,
    );

    return report;
  };

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut FP16 six-image gate</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js?session=${encodedSessionToken}"></script>
  </body>
</html>
`;

const config = {
  cases:
    manifest.cases.map(
      (
        benchmarkCase,
        index,
      ) => ({
        id:
          benchmarkCase.id,
        inputUrl:
          `/input/${index}`,
      }),
    ),
  runsPerCase,
  timeoutMs,
  blocks,
};

const app =
  Bun.serve({
    hostname:
      "127.0.0.1",
    port,
    async fetch(request) {
      const url =
        new URL(
          request.url,
        );

      const sessionAuthorized =
        request.headers.get(
          "x-bgcut-benchmark-session",
        ) ===
        sessionToken;

      const requestedBlock =
        Number.parseInt(
          url.searchParams.get(
            "block",
          ) ??
            "",
          10,
        );

      const queryLaunchAuthorized =
        activeLaunch !==
          undefined &&
        url.searchParams.get(
          "launch",
        ) ===
          activeLaunch.token &&
        requestedBlock ===
          activeLaunch.blockIndex;

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/activate"
      ) {
        if (
          !sessionAuthorized
        ) {
          return new Response(
            "Unauthorized benchmark session.",
            {
              status: 403,
            },
          );
        }

        if (
          activeLaunch !==
          undefined
        ) {
          return new Response(
            `Benchmark launch for block ${activeLaunch.blockIndex} is still active.`,
            {
              status: 409,
            },
          );
        }

        const activation =
          Schema.decodeUnknownSync(
            ActivationSchema,
          )(
            await request.json(),
          );

        if (
          activation.launchToken.length <
          8
        ) {
          return new Response(
            "Benchmark launch token is too short.",
            {
              status: 422,
            },
          );
        }

        if (
          blocks.at(
            activation.blockIndex,
          ) ===
            undefined
        ) {
          return new Response(
            `Unknown benchmark block ${activation.blockIndex}.`,
            {
              status: 422,
            },
          );
        }

        activeLaunch = {
          token:
            activation.launchToken,
          blockIndex:
            activation.blockIndex,
          primeOnly:
            activation.primeOnly,
        };

        console.log(
          `Activated ${activation.primeOnly ? "prewarm" : "measured"} block ${activation.blockIndex}.`,
        );

        return new Response(
          "activated",
        );
      }

      const mutationAuthorized =
        sessionAuthorized &&
        activeLaunch !==
          undefined &&
        request.headers.get(
          "x-bgcut-benchmark-launch",
        ) ===
          activeLaunch.token;

      if (
        request.method ===
          "POST" &&
        !mutationAuthorized
      ) {
        console.warn(
          `Rejected stale benchmark write: ${url.pathname}`,
        );

        return new Response(
          "Unauthorized benchmark launch.",
          {
            status: 403,
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/"
      ) {
        return new Response(
          "bgcut FP16 six-image benchmark server ready.",
          {
            headers: {
              "content-type":
                "text/plain; charset=utf-8",
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          sessionPath &&
        queryLaunchAuthorized
      ) {
        return new Response(
          html,
          {
            headers: {
              "content-type":
                "text/html; charset=utf-8",
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/client.js" &&
        url.searchParams.get(
          "session",
        ) ===
          sessionToken
      ) {
        return new Response(
          clientSource,
          {
            headers: {
              "content-type":
                "text/javascript; charset=utf-8",
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/config.json" &&
        url.searchParams.get(
          "session",
        ) ===
          sessionToken &&
        queryLaunchAuthorized
      ) {
        return Response.json(
          config,
          {
            headers: {
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          FP32_MODEL_PATH
      ) {
        return new Response(
          fp32ModelFile,
          {
            headers: {
              "content-type":
                "application/octet-stream",
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          FP16_MODEL_PATH
      ) {
        return new Response(
          fp16ModelFile,
          {
            headers: {
              "content-type":
                "application/octet-stream",
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          ORT_WEBGPU_WASM_PUBLIC_PATH
      ) {
        return new Response(
          runtimeFile,
          {
            headers: {
              "content-type":
                "application/wasm",
              "cache-control":
                "no-store",
            },
          },
        );
      }

      const inputMatch =
        url.pathname.match(
          /^\/input\/(\d+)$/u,
        );

      if (
        request.method ===
          "GET" &&
        inputMatch !==
          null
      ) {
        const caseIndex =
          Number.parseInt(
            inputMatch[
              1
            ],
            10,
          );

        const benchmarkCase =
          manifest.cases.at(
            caseIndex,
          );

        if (
          benchmarkCase ===
            undefined
        ) {
          return new Response(
            "Unknown benchmark input.",
            {
              status: 404,
            },
          );
        }

        return new Response(
          Bun.file(
            resolve(
              manifestRoot,
              benchmarkCase.input,
            ),
          ),
          {
            headers: {
              "cache-control":
                "no-store",
            },
          },
        );
      }

      const outputMatch =
        url.pathname.match(
          /^\/output\/(\d+)\/(\d+)\/(\d+)$/u,
        );

      if (
        request.method ===
          "POST" &&
        outputMatch !==
          null
      ) {
        const blockIndex =
          Number.parseInt(
            outputMatch[
              1
            ],
            10,
          );

        const caseIndex =
          Number.parseInt(
            outputMatch[
              2
            ],
            10,
          );

        const run =
          Number.parseInt(
            outputMatch[
              3
            ],
            10,
          );

        const block =
          blocks.at(
            blockIndex,
          );

        const benchmarkCase =
          manifest.cases.at(
            caseIndex,
          );

        if (
          block ===
            undefined ||
          benchmarkCase ===
            undefined ||
          activeLaunch?.blockIndex !==
            blockIndex ||
          run <
            1 ||
          run >
            runsPerCase
        ) {
          return new Response(
            "Unknown FP16 six-image output.",
            {
              status: 404,
            },
          );
        }

        const targetPath =
          outputPath(
            blockIndex,
            caseIndex,
            run,
          );

        await writeFile(
          targetPath,
          new Uint8Array(
            await request.arrayBuffer(),
          ),
        );

        const stats =
          await sharp(
            targetPath,
          )
            .ensureAlpha()
            .stats();

        const alpha =
          stats.channels.at(
            3,
          );

        if (
          alpha ===
            undefined ||
          alpha.max ===
            0
        ) {
          return new Response(
            `Block ${blockIndex}, ${benchmarkCase.id}, run ${run} is fully transparent.`,
            {
              status: 422,
            },
          );
        }

        return new Response(
          "saved",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/run"
      ) {
        const record =
          Schema.decodeUnknownSync(
            RunRecordSchema,
          )(
            await request.json(),
          );

        if (
          record.blockIndex !==
          activeLaunch?.blockIndex
        ) {
          return new Response(
            "Run record does not match the active benchmark block.",
            {
              status: 409,
            },
          );
        }

        const directory =
          join(
            runsRoot,
            `block-${record.blockIndex}`,
          );

        await mkdir(
          directory,
          {
            recursive: true,
          },
        );

        await writeJson(
          join(
            directory,
            `${safeOutputName(
              record.caseId,
            )}-run-${record.run}.json`,
          ),
          record,
        );

        return new Response(
          "saved",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/prime"
      ) {
        const record =
          Schema.decodeUnknownSync(
            PrimeRecordSchema,
          )(
            await request.json(),
          );

        const launch =
          activeLaunch;

        if (
          launch ===
            undefined ||
          record.blockIndex !==
            launch.blockIndex
        ) {
          return new Response(
            "Prime record does not match the active benchmark block.",
            {
              status: 409,
            },
          );
        }

        const primeOnly =
          launch.primeOnly;

        const directory =
          join(
            runsRoot,
            `block-${record.blockIndex}`,
          );

        await mkdir(
          directory,
          {
            recursive: true,
          },
        );

        await writeJson(
          join(
            directory,
            "prime.json",
          ),
          record,
        );

        if (
          primeOnly
        ) {
          activeLaunch =
            undefined;
        }

        return new Response(
          "saved",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/failure"
      ) {
        const record =
          Schema.decodeUnknownSync(
            FailureRecordSchema,
          )(
            await request.json(),
          );

        if (
          record.blockIndex !==
          activeLaunch?.blockIndex
        ) {
          return new Response(
            "Failure record does not match the active benchmark block.",
            {
              status: 409,
            },
          );
        }

        await writeJson(
          join(
            outputRoot,
            "browser-failure.json",
          ),
          record,
        );

        activeLaunch =
          undefined;

        return new Response(
          "failure recorded",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/block-report"
      ) {
        const report =
          Schema.decodeUnknownSync(
            BlockReportSchema,
          )(
            await request.json(),
          );

        if (
          report.block.index !==
          activeLaunch?.blockIndex
        ) {
          return new Response(
            "Block report does not match the active benchmark block.",
            {
              status: 409,
            },
          );
        }

        const expectedRuns =
          manifest.cases.length *
          runsPerCase;

        if (
          report.runs.length !==
          expectedRuns
        ) {
          return new Response(
            `Block ${report.block.index} has ${report.runs.length} measured runs; expected ${expectedRuns}.`,
            {
              status: 422,
            },
          );
        }

        if (
          report.runs.some(
            (record) =>
              !record.timings
                .sessionReused,
          )
        ) {
          return new Response(
            `Block ${report.block.index} contains a measured call that did not reuse its session.`,
            {
              status: 422,
            },
          );
        }

        reports.set(
          report.block.index,
          report,
        );

        await writeJson(
          join(
            blocksRoot,
            `block-${report.block.index}.json`,
          ),
          report,
        );

        activeLaunch =
          undefined;

        const done =
          reports.size ===
          blocks.length;

        if (
          done
        ) {
          try {
            await finalize();
          } catch (error) {
            return new Response(
              error instanceof Error
                ? error.message
                : String(
                    error,
                  ),
              {
                status: 422,
              },
            );
          }
        }

        return Response.json({
          done,
        });
      }

      return new Response(
        "Not found.",
        {
          status: 404,
        },
      );
    },
  });

console.log(
  `Safari FP16 six-image gate ready at http://${app.hostname}:${app.port}${sessionPath} across ${manifest.cases.length} cases.`,
);
