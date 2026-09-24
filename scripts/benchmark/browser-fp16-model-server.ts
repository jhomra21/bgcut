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

const BlockSchema = Schema.Struct({
  index: Schema.Number,
  sequence: SequenceSchema,
  mode: ModeSchema,
  modelPath: Schema.String,
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
  mode: ModeSchema,
  run: Schema.Number,
  timings: RemovalTimingsSchema,
});

const PrimeRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  blockIndex: Schema.Number,
  sequence: SequenceSchema,
  mode: ModeSchema,
  timings: RemovalTimingsSchema,
});

const FailureRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  blockIndex: Schema.Number,
  sequence: SequenceSchema,
  mode: ModeSchema,
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
  caseId: Schema.String,
  block: BlockSchema,
  runs: Schema.Array(
    RunRecordSchema,
  ),
  prime: PrimeRecordSchema,
});

type Mode =
  Schema.Schema.Type<
    typeof ModeSchema
  >;

type Sequence =
  Schema.Schema.Type<
    typeof SequenceSchema
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

type QualityMetrics = {
  readonly pixels: number;
  readonly mae: number;
  readonly mse: number;
  readonly iou: number;
  readonly f1: number;
};

type QualitySummary = {
  readonly maeMedian: number;
  readonly mseMedian: number;
  readonly iouMedian: number;
  readonly f1Median: number;
};

type PixelComparison = {
  readonly left: string;
  readonly right: string;
  readonly pixels: number;
  readonly values: number;
  readonly differingValues: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
  readonly alphaDifferences: number;
  readonly meanAbsoluteAlphaByteDifference: number;
  readonly maxAbsoluteAlphaByteDifference: number;
};

type TrialSummary = {
  readonly trial: number;
  readonly sequence: Sequence;
  readonly fp32Block: number;
  readonly fp16Block: number;
  readonly comparison: ModeComparison;
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly caseId: string;
  readonly runs: number;
  readonly fp32Model: {
    readonly sizeBytes: number;
    readonly sha256: string;
  };
  readonly fp16Model: {
    readonly sizeBytes: number;
    readonly sha256: string;
  };
  readonly aggregate: ModeComparison;
  readonly bySequence: Readonly<
    Record<
      Sequence,
      ModeComparison
    >
  >;
  readonly byPosition: {
    readonly first: ModeComparison;
    readonly second: ModeComparison;
  };
  readonly trials: readonly TrialSummary[];
  readonly quality: Readonly<
    Record<
      Mode,
      QualitySummary
    >
  >;
  readonly parity: {
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

type Raster = {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Uint8Array;
};

const usage =
  "Usage: bun run benchmark:browser-fp16-model -- <manifest.json> <output-dir> <fp32-model.onnx> <fp16-model.onnx> [runs] [timeout-ms] [port] [case-id]";

const [
  manifestArgument,
  outputArgument,
  fp32ModelArgument,
  fp16ModelArgument,
  runsArgument = "3",
  timeoutArgument = "60000",
  portArgument = "4184",
  caseId = "cat-in-sink",
] = process.argv.slice(2);

if (
  manifestArgument === undefined ||
  outputArgument === undefined ||
  fp32ModelArgument === undefined ||
  fp16ModelArgument === undefined
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

const runs =
  Number.parseInt(
    runsArgument,
    10,
  );

if (
  !Number.isInteger(
    runs,
  ) ||
  runs < 3
) {
  throw new Error(
    `Runs must be an integer >= 3, received "${runsArgument}".`,
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
  timeoutMs < 1
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
  port < 1
) {
  throw new Error(
    `Port must be a positive integer, received "${portArgument}".`,
  );
}

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

const benchmarkCase =
  manifest.cases.find(
    (candidate) =>
      candidate.id ===
      caseId,
  );

if (
  benchmarkCase === undefined
) {
  throw new Error(
    `Benchmark case "${caseId}" was not found in the manifest.`,
  );
}

const blocks:
  readonly Block[] = [
    {
      index: 0,
      sequence:
        "fp32-first",
      mode:
        "fp32",
      modelPath:
        FP32_MODEL_PATH,
    },
    {
      index: 1,
      sequence:
        "fp32-first",
      mode:
        "fp16",
      modelPath:
        FP16_MODEL_PATH,
    },
    {
      index: 2,
      sequence:
        "fp16-first",
      mode:
        "fp16",
      modelPath:
        FP16_MODEL_PATH,
    },
    {
      index: 3,
      sequence:
        "fp16-first",
      mode:
        "fp32",
      modelPath:
        FP32_MODEL_PATH,
    },
    {
      index: 4,
      sequence:
        "fp16-first",
      mode:
        "fp16",
      modelPath:
        FP16_MODEL_PATH,
    },
    {
      index: 5,
      sequence:
        "fp16-first",
      mode:
        "fp32",
      modelPath:
        FP32_MODEL_PATH,
    },
    {
      index: 6,
      sequence:
        "fp32-first",
      mode:
        "fp32",
      modelPath:
        FP32_MODEL_PATH,
    },
    {
      index: 7,
      sequence:
        "fp32-first",
      mode:
        "fp16",
      modelPath:
        FP16_MODEL_PATH,
    },
  ];

const trials = [
  {
    trial: 1,
    sequence:
      "fp32-first" as const,
    fp32Block: 0,
    fp16Block: 1,
  },
  {
    trial: 2,
    sequence:
      "fp16-first" as const,
    fp32Block: 3,
    fp16Block: 2,
  },
  {
    trial: 3,
    sequence:
      "fp16-first" as const,
    fp32Block: 5,
    fp16Block: 4,
  },
  {
    trial: 4,
    sequence:
      "fp32-first" as const,
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
        "browser-fp16-model-client.ts",
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
    `Could not build FP16 benchmark client.\n${build.logs
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
    "FP16 benchmark client produced no bundle.",
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
    .BGCUT_BROWSER_FP16_MODEL_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser FP16 model bundle check passed.",
  );

  process.exit(
    0,
  );
}

const [
  fp32Fingerprint,
  fp16Fingerprint,
] =
  await Promise.all([
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
  fp32Fingerprint
    ?.sizeBytes !==
    MODEL_SIZE_BYTES ||
  fp32Fingerprint.sha256 !==
    MODEL_SHA256
) {
  throw new Error(
    "FP32 benchmark model does not match the validated production artifact.",
  );
}

if (
  fp16Fingerprint
    ?.sizeBytes !==
    FP16_MODEL_SIZE_BYTES ||
  fp16Fingerprint.sha256 !==
    FP16_MODEL_SHA256
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

const outputPath = (
  blockIndex: number,
  run: number,
): string =>
  join(
    outputsRoot,
    `block-${blockIndex}`,
    `run-${run}.png`,
  );

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
  values: readonly number[],
): number => {
  if (
    values.length ===
    0
  ) {
    throw new Error(
      "Cannot calculate a median from no values.",
    );
  }

  const sorted =
    [...values].sort(
      (left, right) =>
        left - right,
    );

  const middle =
    Math.floor(
      sorted.length / 2,
    );

  return sorted.length %
      2 ===
    1
    ? sorted[
        middle
      ]
    : (
        sorted[
          middle - 1
        ] +
        sorted[
          middle
        ]
      ) / 2;
};

const summarize = (
  records: readonly RunRecord[],
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
  fp32: readonly RunRecord[],
  fp16: readonly RunRecord[],
): ModeComparison => {
  const fp32Summary =
    summarize(
      fp32,
    );

  const fp16Summary =
    summarize(
      fp16,
    );

  return {
    fp32:
      fp32Summary,
    fp16:
      fp16Summary,
    inferenceChangePercent:
      percentChange(
        fp32Summary
          .inferenceMedianMs,
        fp16Summary
          .inferenceMedianMs,
      ),
    totalChangePercent:
      percentChange(
        fp32Summary
          .totalMedianMs,
        fp16Summary
          .totalMedianMs,
      ),
  };
};

const readRaster = async (
  path: string,
): Promise<Raster> => {
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

  return {
    width:
      result.info.width,
    height:
      result.info.height,
    channels:
      result.info.channels,
    data:
      new Uint8Array(
        result.data,
      ),
  };
};

const readMask = async (
  path: string,
): Promise<Raster> => {
  const result =
    await sharp(
      path,
    )
      .greyscale()
      .raw()
      .toBuffer({
        resolveWithObject:
          true,
      });

  return {
    width:
      result.info.width,
    height:
      result.info.height,
    channels:
      result.info.channels,
    data:
      new Uint8Array(
        result.data,
      ),
  };
};

const mask =
  await readMask(
    resolve(
      manifestRoot,
      benchmarkCase.mask,
    ),
  );

const score = async (
  blockIndex: number,
  run: number,
): Promise<QualityMetrics> => {
  const output =
    await readRaster(
      outputPath(
        blockIndex,
        run,
      ),
    );

  if (
    output.width !==
      mask.width ||
    output.height !==
      mask.height ||
    output.channels !==
      4
  ) {
    throw new Error(
      `Output dimensions for block ${blockIndex}, run ${run} do not match the reference mask.`,
    );
  }

  let absoluteError = 0;

  let squaredError = 0;

  let truePositive = 0;

  let falsePositive = 0;

  let falseNegative = 0;

  const pixels =
    output.width *
    output.height;

  for (
    let pixel = 0;
    pixel <
    pixels;
    pixel += 1
  ) {
    const predicted =
      output.data[
        pixel * 4 +
        3
      ];

    const expected =
      mask.data[
        pixel *
        mask.channels
      ];

    const difference =
      Math.abs(
        predicted -
        expected,
      ) /
      255;

    absoluteError +=
      difference;

    squaredError +=
      difference *
      difference;

    const predictedForeground =
      predicted >=
      128;

    const expectedForeground =
      expected >=
      128;

    if (
      predictedForeground &&
      expectedForeground
    ) {
      truePositive +=
        1;
    } else if (
      predictedForeground
    ) {
      falsePositive +=
        1;
    } else if (
      expectedForeground
    ) {
      falseNegative +=
        1;
    }
  }

  const union =
    truePositive +
    falsePositive +
    falseNegative;

  const f1Denominator =
    2 *
      truePositive +
    falsePositive +
    falseNegative;

  return {
    pixels,
    mae:
      absoluteError /
      pixels,
    mse:
      squaredError /
      pixels,
    iou:
      union ===
        0
        ? 1
        : truePositive /
          union,
    f1:
      f1Denominator ===
        0
        ? 1
        : (
            2 *
            truePositive
          ) /
          f1Denominator,
  };
};

const summarizeQuality = (
  metrics:
    readonly QualityMetrics[],
): QualitySummary => ({
  maeMedian:
    median(
      metrics.map(
        (value) =>
          value.mae,
      ),
    ),
  mseMedian:
    median(
      metrics.map(
        (value) =>
          value.mse,
      ),
    ),
  iouMedian:
    median(
      metrics.map(
        (value) =>
          value.iou,
      ),
    ),
  f1Median:
    median(
      metrics.map(
        (value) =>
          value.f1,
      ),
    ),
});

const comparePixels = async (
  leftBlock: number,
  leftRun: number,
  rightBlock: number,
  rightRun: number,
): Promise<PixelComparison> => {
  const [
    left,
    right,
  ] =
    await Promise.all([
      readRaster(
        outputPath(
          leftBlock,
          leftRun,
        ),
      ),
      readRaster(
        outputPath(
          rightBlock,
          rightRun,
        ),
      ),
    ]);

  if (
    left.width !==
      right.width ||
    left.height !==
      right.height ||
    left.channels !==
      4 ||
    right.channels !==
      4
  ) {
    throw new Error(
      `Output dimensions differ between block ${leftBlock} run ${leftRun} and block ${rightBlock} run ${rightRun}.`,
    );
  }

  let absolute = 0;

  let maximum = 0;

  let differing = 0;

  let alphaAbsolute = 0;

  let alphaMaximum = 0;

  let alphaDifferences = 0;

  for (
    let index = 0;
    index <
    left.data.length;
    index += 1
  ) {
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
    }

    if (
      index % 4 ===
      3
    ) {
      alphaAbsolute +=
        difference;

      alphaMaximum =
        Math.max(
          alphaMaximum,
          difference,
        );

      if (
        difference !==
        0
      ) {
        alphaDifferences +=
          1;
      }
    }
  }

  const pixels =
    left.width *
    left.height;

  return {
    left:
      `block-${leftBlock}-run-${leftRun}`,
    right:
      `block-${rightBlock}-run-${rightRun}`,
    pixels,
    values:
      left.data.length,
    differingValues:
      differing,
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
  };
};

const compareRunPairs = async (
  leftBlock: number,
  rightBlock: number,
): Promise<
  readonly PixelComparison[]
> =>
  Promise.all(
    Array.from(
      {
        length:
          runs,
      },
      (
        _,
        index,
      ) =>
        comparePixels(
          leftBlock,
          index + 1,
          rightBlock,
          index + 1,
        ),
    ),
  );

const compareWithinBlock = async (
  blockIndex: number,
): Promise<
  readonly PixelComparison[]
> => {
  const comparisons:
    PixelComparison[] = [];

  for (
    let left = 1;
    left <=
    runs;
    left += 1
  ) {
    for (
      let right =
        left + 1;
      right <=
      runs;
      right += 1
    ) {
      comparisons.push(
        await comparePixels(
          blockIndex,
          left,
          blockIndex,
          right,
        ),
      );
    }
  }

  return comparisons;
};

const finalize =
  async (): Promise<void> => {
    const allReports =
      blocks.map(
        (block) => {
          const report =
            reports.get(
              block.index,
            );

          if (
            report ===
            undefined
          ) {
            throw new Error(
              `Missing FP16 benchmark block ${block.index}.`,
            );
          }

          return report;
        },
      );

    const runsForBlocks = (
      blockIndexes:
        readonly number[],
    ): readonly RunRecord[] =>
      blockIndexes.flatMap(
        (blockIndex) => {
          const report =
            reports.get(
              blockIndex,
            );

          if (
            report ===
            undefined
          ) {
            throw new Error(
              `Missing FP16 benchmark block ${blockIndex}.`,
            );
          }

          return report.runs;
        },
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

    const fp32Runs =
      runsForBlocks(
        fp32Blocks,
      );

    const fp16Runs =
      runsForBlocks(
        fp16Blocks,
      );

    const summarizeSequence = (
      sequence: Sequence,
    ): ModeComparison => {
      const selected =
        sequenceBlocks[
          sequence
        ];

      return compareTimings(
        runsForBlocks(
          selected.fp32,
        ),
        runsForBlocks(
          selected.fp16,
        ),
      );
    };

    const firstFp32Blocks =
      sequenceBlocks[
        "fp32-first"
      ].fp32;

    const firstFp16Blocks =
      sequenceBlocks[
        "fp16-first"
      ].fp16;

    const secondFp32Blocks =
      sequenceBlocks[
        "fp16-first"
      ].fp32;

    const secondFp16Blocks =
      sequenceBlocks[
        "fp32-first"
      ].fp16;

    const fp32Quality:
      QualityMetrics[] = [];

    const fp16Quality:
      QualityMetrics[] = [];

    for (
      const block of
      blocks
    ) {
      for (
        let run = 1;
        run <=
        runs;
        run += 1
      ) {
        const metrics =
          await score(
            block.index,
            run,
          );

        if (
          block.mode ===
          "fp32"
        ) {
          fp32Quality.push(
            metrics,
          );
        } else {
          fp16Quality.push(
            metrics,
          );
        }
      }
    }

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
      (
        await Promise.all(
          blocks.map(
            (block) =>
              compareWithinBlock(
                block.index,
              ),
          ),
        )
      ).flat();

    const [
      fp32CrossOne,
      fp32CrossTwo,
      fp32CrossThree,
      fp16CrossOne,
      fp16CrossTwo,
      fp16CrossThree,
    ] =
      await Promise.all([
        compareRunPairs(
          fp32Blocks[0],
          fp32Blocks[1],
        ),
        compareRunPairs(
          fp32Blocks[0],
          fp32Blocks[2],
        ),
        compareRunPairs(
          fp32Blocks[0],
          fp32Blocks[3],
        ),
        compareRunPairs(
          fp16Blocks[0],
          fp16Blocks[1],
        ),
        compareRunPairs(
          fp16Blocks[0],
          fp16Blocks[2],
        ),
        compareRunPairs(
          fp16Blocks[0],
          fp16Blocks[3],
        ),
      ]);

    const trialSummaries:
      TrialSummary[] =
      trials.map(
        (trial) => ({
          trial:
            trial.trial,
          sequence:
            trial.sequence,
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

    const report:
      FinalReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        caseId,
        runs,
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
        aggregate:
          compareTimings(
            fp32Runs,
            fp16Runs,
          ),
        bySequence: {
          "fp32-first":
            summarizeSequence(
              "fp32-first",
            ),
          "fp16-first":
            summarizeSequence(
              "fp16-first",
            ),
        },
        byPosition: {
          first:
            compareTimings(
              runsForBlocks(
                firstFp32Blocks,
              ),
              runsForBlocks(
                firstFp16Blocks,
              ),
            ),
          second:
            compareTimings(
              runsForBlocks(
                secondFp32Blocks,
              ),
              runsForBlocks(
                secondFp16Blocks,
              ),
            ),
        },
        trials:
          trialSummaries,
        quality: {
          fp32:
            summarizeQuality(
              fp32Quality,
            ),
          fp16:
            summarizeQuality(
              fp16Quality,
            ),
        },
        parity: {
          paired,
          withinBlock,
          crossContext: [
            ...fp32CrossOne,
            ...fp32CrossTwo,
            ...fp32CrossThree,
            ...fp16CrossOne,
            ...fp16CrossTwo,
            ...fp16CrossThree,
          ],
        },
        reports:
          allReports,
      };

    await writeJson(
      join(
        outputRoot,
        "browser-fp16-model.json",
      ),
      report,
    );
  };

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut FP16 model benchmark</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const config = {
  caseId:
    benchmarkCase.id,
  inputUrl:
    "/input",
  runs,
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

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/"
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
          "/client.js"
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
          "/config.json"
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

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/input"
      ) {
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
          /^\/output\/(\d+)\/(\d+)$/u,
        );

      if (
        request.method ===
          "POST" &&
        outputMatch !==
          null
      ) {
        const blockIndex =
          Number.parseInt(
            outputMatch[1],
            10,
          );

        const run =
          Number.parseInt(
            outputMatch[2],
            10,
          );

        if (
          blocks.at(
            blockIndex,
          ) ===
            undefined ||
          run < 1 ||
          run >
            runs
        ) {
          return new Response(
            "Unknown FP16 benchmark output.",
            {
              status: 404,
            },
          );
        }

        const targetPath =
          outputPath(
            blockIndex,
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
            `Block ${blockIndex} run ${run} is fully transparent.`,
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
            `run-${record.run}.json`,
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

        await writeJson(
          join(
            outputRoot,
            "browser-failure.json",
          ),
          record,
        );

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

        const nextBlock =
          blocks.at(
            report.block.index +
              1,
          );

        if (
          nextBlock !==
          undefined
        ) {
          return Response.json({
            done: false,
            nextBlock:
              nextBlock.index,
          });
        }

        try {
          await finalize();
        } catch (error) {
          return new Response(
            error instanceof Error
              ? error.message
              : String(error),
            {
              status: 422,
            },
          );
        }

        return Response.json({
          done:
            true,
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
  `Safari FP16 model benchmark ready at http://${app.hostname}:${app.port}/ for ${benchmarkCase.id}.`,
);
