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

const StrategySchema = Schema.Literal(
  "late-source",
  "early-source",
);

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
  strategy: StrategySchema,
  caseId: Schema.String,
  run: Schema.Number,
  timings: RemovalTimingsSchema,
});

const StrategyReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  userAgent: Schema.String,
  strategy: StrategySchema,
  targetCaseId: Schema.String,
  runsPerCase: Schema.Number,
  runs: Schema.Array(
    RunRecordSchema,
  ),
});

const FailureRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  strategy: StrategySchema,
  caseId: Schema.String,
  run: Schema.Union(
    Schema.Number,
    Schema.Literal("prime"),
  ),
  elapsedMs: Schema.Number,
  message: Schema.String,
  stack: Schema.String,
});

type Strategy =
  Schema.Schema.Type<
    typeof StrategySchema
  >;

type StrategyReport =
  Schema.Schema.Type<
    typeof StrategyReportSchema
  >;

type RunRecord =
  Schema.Schema.Type<
    typeof RunRecordSchema
  >;

type FailureRecord =
  Schema.Schema.Type<
    typeof FailureRecordSchema
  >;

type ChannelStats = {
  readonly differingValues: number;
  readonly maxAbsoluteByteDifference: number;
  readonly meanAbsoluteByteDifference: number;
};

type Comparison = {
  readonly left: string;
  readonly right: string;
  readonly values: number;
  readonly pixels: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
  readonly maxAbsoluteByteDifference: number;
  readonly meanAbsoluteByteDifference: number;
  readonly channels: {
    readonly r: ChannelStats;
    readonly g: ChannelStats;
    readonly b: ChannelStats;
    readonly a: ChannelStats;
  };
};

type TimingSummary = {
  readonly inferenceMedianMs: number;
  readonly compositeMedianMs: number;
  readonly totalMedianMs: number;
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly targetCaseId: string;
  readonly runsPerCase: number;
  readonly reports: readonly StrategyReport[];
  readonly timings: {
    readonly lateSource: TimingSummary;
    readonly earlySource: TimingSummary;
  };
  readonly withinStrategy: {
    readonly lateSource: readonly Comparison[];
    readonly earlySource: readonly Comparison[];
  };
  readonly earlyVersusStableLate: readonly Comparison[];
  readonly allCrossStrategy: readonly Comparison[];
};

type PersistedRecord =
  | RunRecord
  | FailureRecord
  | StrategyReport
  | FinalReport;

const usage =
  "Usage: bun run benchmark:browser-source-snapshot -- <manifest.json> <output-dir> <model.onnx> [runs-per-case] [timeout-ms] [port] [target-case-id]";

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  runsArgument = "3",
  timeoutArgument = "60000",
  portArgument = "4184",
  targetCaseId = "dog-blind-dog",
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

const outputDirectory =
  join(
    outputRoot,
    "outputs",
  );

const runDirectory =
  join(
    outputRoot,
    "runs",
  );

const reportDirectory =
  join(
    outputRoot,
    "strategies",
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

const targetIndex =
  manifest.cases.findIndex(
    (benchmarkCase) =>
      benchmarkCase.id ===
      targetCaseId,
  );

if (
  targetIndex < 0
) {
  throw new Error(
    `Target case "${targetCaseId}" was not found in the manifest.`,
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

const strategies:
  readonly Strategy[] = [
    "late-source",
    "early-source",
  ];

await Promise.all([
  mkdir(
    outputRoot,
    {
      recursive: true,
    },
  ),
  mkdir(
    runDirectory,
    {
      recursive: true,
    },
  ),
  mkdir(
    reportDirectory,
    {
      recursive: true,
    },
  ),
  ...strategies.map(
    (strategy) =>
      mkdir(
        join(
          outputDirectory,
          strategy,
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
        "browser-source-snapshot-client.ts",
      ),
    ],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
  });

if (
  !build.success
) {
  throw new Error(
    `Could not build source-snapshot benchmark client.\n${build.logs
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
  clientOutput ===
  undefined
) {
  throw new Error(
    "Source-snapshot benchmark client produced no bundle.",
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
    .BGCUT_BROWSER_SOURCE_SNAPSHOT_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser source-snapshot bundle check passed.",
  );

  process.exit(0);
}

const reports =
  new Map<
    Strategy,
    StrategyReport
  >();

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

const outputPath = (
  strategy: Strategy,
  run: number,
): string =>
  join(
    outputDirectory,
    strategy,
    `run-${run}.png`,
  );

const readRaster = async (
  strategy: Strategy,
  run: number,
) => {
  const result =
    await sharp(
      outputPath(
        strategy,
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
      `Expected RGBA output for ${strategy} run ${run}.`,
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

const compare = async (
  leftStrategy: Strategy,
  leftRun: number,
  rightStrategy: Strategy,
  rightRun: number,
): Promise<Comparison> => {
  const [
    left,
    right,
  ] =
    await Promise.all([
      readRaster(
        leftStrategy,
        leftRun,
      ),
      readRaster(
        rightStrategy,
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
      `Dimensions differ between ${leftStrategy} run ${leftRun} and ${rightStrategy} run ${rightRun}.`,
    );
  }

  const absolute =
    [0, 0, 0, 0];

  const maximum =
    [0, 0, 0, 0];

  const differing =
    [0, 0, 0, 0];

  let totalAbsolute = 0;

  let totalMaximum = 0;

  let totalDiffering = 0;

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

    const channel =
      index % 4;

    absolute[
      channel
    ] += difference;

    maximum[
      channel
    ] =
      Math.max(
        maximum[
          channel
        ],
        difference,
      );

    totalAbsolute +=
      difference;

    totalMaximum =
      Math.max(
        totalMaximum,
        difference,
      );

    if (
      difference !== 0
    ) {
      differing[
        channel
      ] += 1;

      totalDiffering +=
        1;
    }
  }

  const pixels =
    left.data.length / 4;

  const channelStats = (
    index: number,
  ): ChannelStats => ({
    differingValues:
      differing[
        index
      ],
    maxAbsoluteByteDifference:
      maximum[
        index
      ],
    meanAbsoluteByteDifference:
      absolute[
        index
      ] /
      pixels,
  });

  return {
    left:
      `${leftStrategy}-run-${leftRun}`,
    right:
      `${rightStrategy}-run-${rightRun}`,
    values:
      left.data.length,
    pixels,
    differingValues:
      totalDiffering,
    differingValueFraction:
      totalDiffering /
      left.data.length,
    maxAbsoluteByteDifference:
      totalMaximum,
    meanAbsoluteByteDifference:
      totalAbsolute /
      left.data.length,
    channels: {
      r:
        channelStats(0),
      g:
        channelStats(1),
      b:
        channelStats(2),
      a:
        channelStats(3),
    },
  };
};

const withinStrategy =
  async (
    strategy: Strategy,
  ): Promise<
    readonly Comparison[]
  > => {
    const comparisons:
      Comparison[] = [];

    for (
      let left = 1;
      left <=
      runsPerCase;
      left += 1
    ) {
      for (
        let right =
          left + 1;
        right <=
        runsPerCase;
        right += 1
      ) {
        comparisons.push(
          await compare(
            strategy,
            left,
            strategy,
            right,
          ),
        );
      }
    }

    return comparisons;
  };

const median = (
  values: readonly number[],
): number => {
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

const summarizeTimings = (
  runs: readonly RunRecord[],
): TimingSummary => ({
  inferenceMedianMs:
    median(
      runs.map(
        (run) =>
          run.timings
            .inferenceMs,
      ),
    ),
  compositeMedianMs:
    median(
      runs.map(
        (run) =>
          run.timings
            .compositeMs,
      ),
    ),
  totalMedianMs:
    median(
      runs.map(
        (run) =>
          run.timings
            .totalMs,
      ),
    ),
});

const finalize =
  async (): Promise<void> => {
    const late =
      reports.get(
        "late-source",
      );

    const early =
      reports.get(
        "early-source",
      );

    if (
      late === undefined ||
      early === undefined
    ) {
      throw new Error(
        "Source-snapshot benchmark is missing a strategy report.",
      );
    }

    const earlyVersusStableLate =
      await Promise.all(
        Array.from(
          {
            length:
              runsPerCase,
          },
          (
            _,
            index,
          ) =>
            compare(
              "late-source",
              2,
              "early-source",
              index + 1,
            ),
        ),
      );

    const allCrossStrategy:
      Comparison[] = [];

    for (
      let lateRun = 1;
      lateRun <=
      runsPerCase;
      lateRun += 1
    ) {
      for (
        let earlyRun = 1;
        earlyRun <=
        runsPerCase;
        earlyRun += 1
      ) {
        allCrossStrategy.push(
          await compare(
            "late-source",
            lateRun,
            "early-source",
            earlyRun,
          ),
        );
      }
    }

    const report:
      FinalReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        targetCaseId,
        runsPerCase,
        reports: [
          late,
          early,
        ],
        timings: {
          lateSource:
            summarizeTimings(
              late.runs,
            ),
          earlySource:
            summarizeTimings(
              early.runs,
            ),
        },
        withinStrategy: {
          lateSource:
            await withinStrategy(
              "late-source",
            ),
          earlySource:
            await withinStrategy(
              "early-source",
            ),
        },
        earlyVersusStableLate,
        allCrossStrategy,
      };

    await writeJson(
      join(
        outputRoot,
        "browser-source-snapshot.json",
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
    <title>bgcut source snapshot benchmark</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const config = {
  cases:
    manifest.cases
      .slice(
        0,
        targetIndex + 1,
      )
      .map(
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
  targetCaseId,
  strategies,
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
        url.pathname === "/"
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
        const index =
          Number.parseInt(
            inputMatch[1],
            10,
          );

        const benchmarkCase =
          manifest.cases.at(
            index,
          );

        if (
          benchmarkCase ===
          undefined ||
          index >
            targetIndex
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
          /^\/output\/(late-source|early-source)\/(\d+)$/u,
        );

      if (
        request.method ===
          "POST" &&
        outputMatch !== null
      ) {
        const strategy =
          Schema.decodeUnknownSync(
            StrategySchema,
          )(
            outputMatch[1],
          );

        const run =
          Number.parseInt(
            outputMatch[2],
            10,
          );

        if (
          run < 1 ||
          run >
            runsPerCase
        ) {
          return new Response(
            "Unknown source-snapshot run.",
            {
              status: 404,
            },
          );
        }

        const path =
          outputPath(
            strategy,
            run,
          );

        await writeFile(
          path,
          new Uint8Array(
            await request.arrayBuffer(),
          ),
        );

        const stats =
          await sharp(
            path,
          )
            .ensureAlpha()
            .stats();

        const alpha =
          stats.channels.at(3);

        if (
          alpha === undefined ||
          alpha.max === 0
        ) {
          return new Response(
            `${strategy} run ${run} is fully transparent.`,
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

        await writeJson(
          join(
            runDirectory,
            `${record.strategy}-run-${record.run}.json`,
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
        const failure =
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
          failure,
        );

        return new Response(
          "failure recorded",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/strategy-report"
      ) {
        const report =
          Schema.decodeUnknownSync(
            StrategyReportSchema,
          )(
            await request.json(),
          );

        reports.set(
          report.strategy,
          report,
        );

        await writeJson(
          join(
            reportDirectory,
            `${report.strategy}.json`,
          ),
          report,
        );

        if (
          report.strategy ===
          "late-source"
        ) {
          return Response.json({
            done: false,
            nextStrategy:
              "early-source",
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
          done: true,
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
  `Safari source-snapshot benchmark ready at http://${app.hostname}:${app.port}/ for ${targetCaseId}.`,
);
