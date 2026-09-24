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

import {
  MODEL_FILENAME,
  MODEL_PUBLIC_PATH,
} from "../../src/shared/model-config";
import { ORT_WEBGPU_WASM_PUBLIC_PATH } from "../../src/shared/ort-assets";

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
  "default",
  "wgpu-only",
);

const SequenceSchema = Schema.Literal(
  "default-first",
  "wgpu-first",
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
  caseIndexes: Schema.Array(
    Schema.Number,
  ),
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
  readonly pixelsWithAnyDifference: number;
  readonly pixelsWithAlphaDifference: number;
  readonly pixelsWithRgbDifferenceAndEqualAlpha: number;
};

type ModeComparison = {
  readonly default: TimingSummary;
  readonly wgpuOnly: TimingSummary;
  readonly inferenceChangePercent: number;
  readonly totalChangePercent: number;
};

type PerCaseSummary = ModeComparison & {
  readonly id: string;
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly runsPerCase: number;
  readonly cases: number;
  readonly blocks: readonly Block[];
  readonly aggregate: ModeComparison;
  readonly bySequence: Readonly<
    Record<
      Sequence,
      ModeComparison
    >
  >;
  readonly perCase: readonly PerCaseSummary[];
  readonly parity: {
    readonly pairedAllExact: boolean;
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

const usage =
  "Usage: bun run benchmark:browser-validation-mode:six -- <manifest.json> <output-dir> <model.onnx> [runs-per-case] [timeout-ms] [port]";

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  runsArgument = "3",
  timeoutArgument = "60000",
  portArgument = "4184",
] = process.argv.slice(2);

if (
  manifestArgument === undefined ||
  outputArgument === undefined ||
  modelArgument === undefined
) {
  throw new Error(usage);
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

const modelPath =
  resolve(
    modelArgument,
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
  runsPerCase < 3
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

if (
  manifest.cases.length === 0
) {
  throw new Error(
    "Validation-mode manifest must contain at least one case.",
  );
}

const modelFile =
  Bun.file(
    modelPath,
  );

if (
  !(await modelFile.exists())
) {
  throw new Error(
    `Production model does not exist at ${modelPath}.`,
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
        "default-first",
      direction:
        "forward",
      mode:
        "default",
      caseIndexes:
        forwardIndexes,
    },
    {
      index: 1,
      sequence:
        "default-first",
      direction:
        "forward",
      mode:
        "wgpu-only",
      caseIndexes:
        forwardIndexes,
    },
    {
      index: 2,
      sequence:
        "wgpu-first",
      direction:
        "reverse",
      mode:
        "wgpu-only",
      caseIndexes:
        reverseIndexes,
    },
    {
      index: 3,
      sequence:
        "wgpu-first",
      direction:
        "reverse",
      mode:
        "default",
      caseIndexes:
        reverseIndexes,
    },
  ];

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
        "browser-validation-mode-six-client.ts",
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
    `Could not build validation-mode six-image client.\n${build.logs
      .map(
        (log) =>
          log.message,
      )
      .join("\n")}`,
  );
}

const clientOutput =
  build.outputs.at(0);

if (
  clientOutput === undefined
) {
  throw new Error(
    "Validation-mode six-image client produced no bundle.",
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
    .BGCUT_BROWSER_VALIDATION_MODE_SIX_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser validation-mode six-image bundle check passed.",
  );

  process.exit(0);
}

const reports =
  new Map<
    number,
    BlockReport
  >();

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
    benchmarkCase === undefined
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

const hydrateSavedReports =
  async (): Promise<void> => {
    for (
      const block of
      blocks
    ) {
      const reportPath =
        join(
          blocksRoot,
          `block-${block.index}.json`,
        );

      if (
        !(await Bun.file(
          reportPath,
        ).exists())
      ) {
        continue;
      }

      const report =
        Schema.decodeUnknownSync(
          BlockReportSchema,
        )(
          JSON.parse(
            await readFile(
              reportPath,
              "utf8",
            ),
          ),
        );

      if (
        report.block.index !==
          block.index ||
        report.block.sequence !==
          block.sequence ||
        report.block.direction !==
          block.direction ||
        report.block.mode !==
          block.mode ||
        report.block.caseIndexes.length !==
          block.caseIndexes.length ||
        report.block.caseIndexes.some(
          (caseIndex, index) =>
            caseIndex !==
            block.caseIndexes[
              index
            ],
        )
      ) {
        throw new Error(
          `Saved block ${block.index} does not match the current benchmark plan.`,
        );
      }

      const expectedRuns =
        manifest.cases.length *
        runsPerCase;

      if (
        report.runs.length !==
        expectedRuns
      ) {
        throw new Error(
          `Saved block ${block.index} has ${report.runs.length} runs; expected ${expectedRuns}.`,
        );
      }

      if (
        report.runs.some(
          (record) =>
            !record.timings
              .sessionReused,
        )
      ) {
        throw new Error(
          `Saved block ${block.index} contains a measured run that did not reuse its session.`,
        );
      }

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
          const path =
            outputPath(
              block.index,
              caseIndex,
              run,
            );

          if (
            !(await Bun.file(
              path,
            ).exists())
          ) {
            throw new Error(
              `Saved block ${block.index} is missing output for case ${caseIndex}, run ${run}.`,
            );
          }
        }
      }

      reports.set(
        block.index,
        report,
      );
    }
  };

await hydrateSavedReports();

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
    values.length === 0
  ) {
    throw new Error(
      "Median requires at least one value.",
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

  return sorted.length % 2 ===
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

const compareModes = (
  defaultRuns: readonly RunRecord[],
  combinedRuns: readonly RunRecord[],
): ModeComparison => {
  const defaultSummary =
    summarize(
      defaultRuns,
    );

  const combinedSummary =
    summarize(
      combinedRuns,
    );

  return {
    default:
      defaultSummary,
    wgpuOnly:
      combinedSummary,
    inferenceChangePercent:
      (
        combinedSummary
          .inferenceMedianMs /
          defaultSummary
            .inferenceMedianMs -
        1
      ) * 100,
    totalChangePercent:
      (
        combinedSummary
          .totalMedianMs /
          defaultSummary
            .totalMedianMs -
        1
      ) * 100,
  };
};

const readRaster = async (
  blockIndex: number,
  caseIndex: number,
  run: number,
) => {
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
      result.data,
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
      readRaster(
        leftBlock,
        leftCase,
        leftRun,
      ),
      readRaster(
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
      pixel * 4;

    let pixelDiffers =
      false;

    let rgbDiffers =
      false;

    for (
      let channel = 0;
      channel < 4;
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
        difference !== 0
      ) {
        differing += 1;
        pixelDiffers =
          true;

        if (
          channel < 3
        ) {
          rgbDiffers =
            true;
        }
      }
    }

    const alphaDiffers =
      left.data[
        offset + 3
      ] !==
      right.data[
        offset + 3
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
    pixelsWithAnyDifference,
    pixelsWithAlphaDifference,
    pixelsWithRgbDifferenceAndEqualAlpha,
  };
};

const findBlock = (
  sequence: Sequence,
  mode: Mode,
): Block => {
  const block =
    blocks.find(
      (candidate) =>
        candidate.sequence ===
          sequence &&
        candidate.mode ===
          mode,
    );

  if (
    block === undefined
  ) {
    throw new Error(
      `Missing ${sequence}/${mode} block.`,
    );
  }

  return block;
};

const getReport = (
  blockIndex: number,
): BlockReport => {
  const report =
    reports.get(
      blockIndex,
    );

  if (
    report === undefined
  ) {
    throw new Error(
      `Missing report for block ${blockIndex}.`,
    );
  }

  return report;
};

const comparePaired =
  async (): Promise<
    readonly PixelComparison[]
  > => {
    const comparisons:
      PixelComparison[] = [];

    for (
      const sequence of [
        "default-first",
        "wgpu-first",
      ] as const
    ) {
      const defaultBlock =
        findBlock(
          sequence,
          "default",
        );

      const combinedBlock =
        findBlock(
          sequence,
          "wgpu-only",
        );

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
              defaultBlock.index,
              caseIndex,
              run,
              combinedBlock.index,
              caseIndex,
              run,
            ),
          );
        }
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
              leftRun + 1;
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

    for (
      const mode of [
        "default",
        "wgpu-only",
      ] as const
    ) {
      const first =
        blocks.find(
          (block) =>
            block.mode ===
            mode,
        );

      const second =
        blocks.find(
          (block) =>
            block.mode ===
              mode &&
            block.index !==
              first?.index,
        );

      if (
        first ===
          undefined ||
        second ===
          undefined
      ) {
        throw new Error(
          `Missing paired contexts for ${mode}.`,
        );
      }

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
              first.index,
              caseIndex,
              run,
              second.index,
              caseIndex,
              run,
            ),
          );
        }
      }
    }

    return comparisons;
  };

const finalize =
  async (): Promise<FinalReport> => {
    const allReports =
      blocks.map(
        (block) =>
          getReport(
            block.index,
          ),
      );

    const allRuns =
      allReports.flatMap(
        (report) =>
          report.runs,
      );

    const defaultRuns =
      allRuns.filter(
        (record) =>
          record.mode ===
          "default",
      );

    const combinedRuns =
      allRuns.filter(
        (record) =>
          record.mode ===
          "wgpu-only",
      );

    const summarizeSequence = (
      sequence: Sequence,
    ): ModeComparison => {
      const defaultReport =
        getReport(
          findBlock(
            sequence,
            "default",
          ).index,
        );

      const combinedReport =
        getReport(
          findBlock(
            sequence,
            "wgpu-only",
          ).index,
        );

      return compareModes(
        defaultReport.runs,
        combinedReport.runs,
      );
    };

    const bySequence: Readonly<
      Record<
        Sequence,
        ModeComparison
      >
    > = {
      "default-first":
        summarizeSequence(
          "default-first",
        ),
      "wgpu-first":
        summarizeSequence(
          "wgpu-first",
        ),
    };

    const perCase =
      manifest.cases.map(
        (benchmarkCase) => {
          const defaultCaseRuns =
            defaultRuns.filter(
              (record) =>
                record.caseId ===
                benchmarkCase.id,
            );

          const combinedCaseRuns =
            combinedRuns.filter(
              (record) =>
                record.caseId ===
                benchmarkCase.id,
            );

          return {
            id:
              benchmarkCase.id,
            ...compareModes(
              defaultCaseRuns,
              combinedCaseRuns,
            ),
          };
        },
      );

    const paired =
      await comparePaired();

    const withinBlock =
      await compareWithinBlocks();

    const crossContext =
      await compareCrossContext();

    const report:
      FinalReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        userAgent:
          allReports.at(0)
            ?.userAgent ??
          "",
        runsPerCase,
        cases:
          manifest.cases.length,
        blocks,
        aggregate:
          compareModes(
            defaultRuns,
            combinedRuns,
          ),
        bySequence,
        perCase,
        parity: {
          pairedAllExact:
            paired.every(
              (comparison) =>
                comparison.differingValues ===
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
        "browser-validation-mode-six.json",
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
    <title>bgcut counterbalanced WebGPU provider tuning</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const config = {
  cases:
    manifest.cases.map(
      (benchmarkCase, index) => ({
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
          MODEL_PUBLIC_PATH
      ) {
        return new Response(
          modelFile,
          {
            headers: {
              "content-type":
                "application/octet-stream",
              "cache-control":
                "no-store",
              "x-bgcut-model":
                MODEL_FILENAME,
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
        inputMatch !== null
      ) {
        const caseIndex =
          Number.parseInt(
            inputMatch[1],
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
        outputMatch !== null
      ) {
        const blockIndex =
          Number.parseInt(
            outputMatch[1],
            10,
          );

        const caseIndex =
          Number.parseInt(
            outputMatch[2],
            10,
          );

        const run =
          Number.parseInt(
            outputMatch[3],
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
          run < 1 ||
          run >
            runsPerCase
        ) {
          return new Response(
            "Unknown validation-mode output.",
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
          stats.channels.at(3);

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
            done:
              false,
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
  `Safari counterbalanced validation-mode benchmark ready at http://${app.hostname}:${app.port}/ across ${manifest.cases.length} cases.`,
);
