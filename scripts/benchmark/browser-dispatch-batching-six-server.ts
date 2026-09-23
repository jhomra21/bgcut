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

const ModeSchema = Schema.Union(
  Schema.Literal("default"),
  Schema.Literal(64),
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
  mode: ModeSchema,
  caseId: Schema.String,
  run: Schema.Number,
  timings: RemovalTimingsSchema,
});

const PrimeRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mode: ModeSchema,
  caseId: Schema.String,
  timings: RemovalTimingsSchema,
});

const FailureRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
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

const ModeReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  userAgent: Schema.String,
  strategy: Schema.Literal(
    "no-capture-reuse",
  ),
  sourceSnapshotBeforeInference:
    Schema.Literal(true),
  mode: ModeSchema,
  runsPerCase: Schema.Number,
  prime: PrimeRecordSchema,
  runs: Schema.Array(
    RunRecordSchema,
  ),
});

type Mode =
  Schema.Schema.Type<
    typeof ModeSchema
  >;

type ModeReport =
  Schema.Schema.Type<
    typeof ModeReportSchema
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

type TimingSummary = {
  readonly inferenceMedianMs: number;
  readonly totalMedianMs: number;
  readonly outputReadbackMedianMs: number;
};

type CaseTimingSummary = {
  readonly id: string;
  readonly default: TimingSummary;
  readonly candidate64: TimingSummary;
  readonly inferenceChangePercent: number;
  readonly totalChangePercent: number;
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly strategy: "no-capture-reuse";
  readonly sourceSnapshotBeforeInference: true;
  readonly runsPerCase: number;
  readonly cases: number;
  readonly summary: {
    readonly default: TimingSummary;
    readonly candidate64: TimingSummary;
    readonly inferenceChangePercent: number;
    readonly totalChangePercent: number;
  };
  readonly perCase: readonly CaseTimingSummary[];
  readonly reports: readonly ModeReport[];
};

type CasePixelComparison = {
  readonly id: string;
  readonly runs: number;
  readonly values: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
};

type PixelComparison = {
  readonly schemaVersion: 1;
  readonly comparedRuns: number;
  readonly values: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
  readonly cases: readonly CasePixelComparison[];
};

type PersistedRecord =
  | ModeReport
  | RunRecord
  | PrimeRecord
  | FailureRecord
  | FinalReport
  | PixelComparison;

const usage =
  "Usage: bun run benchmark:browser-dispatch-batching:six -- <manifest.json> <output-dir> <model.onnx> [runs-per-case] [timeout-ms] [port]";

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

const qualityRoot =
  join(
    outputRoot,
    "quality",
  );

const runsRoot =
  join(
    outputRoot,
    "runs",
  );

const modesRoot =
  join(
    outputRoot,
    "modes",
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
  runsPerCase < 1
) {
  throw new Error(
    `Runs per case must be a positive integer, received "${runsArgument}".`,
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
    "Six-image dispatch manifest must contain at least one case.",
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

const modes:
  readonly Mode[] = [
    "default",
    64,
  ];

const modeKey = (
  mode: Mode,
): string =>
  String(mode);

const safeCaseName = (
  id: string,
): string =>
  id
    .replaceAll("/", "__")
    .replaceAll("\\", "__");

const qualityName = (
  id: string,
): string =>
  `${safeCaseName(
    id,
  )}.png`;

const runName = (
  id: string,
  run: number,
): string =>
  `${safeCaseName(
    id,
  )}-run-${run}.png`;

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
    qualityRoot,
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
    modesRoot,
    {
      recursive: true,
    },
  ),
  ...modes.flatMap(
    (mode) => [
      mkdir(
        join(
          outputsRoot,
          modeKey(mode),
        ),
        {
          recursive: true,
        },
      ),
      mkdir(
        join(
          qualityRoot,
          modeKey(mode),
        ),
        {
          recursive: true,
        },
      ),
      mkdir(
        join(
          runsRoot,
          modeKey(mode),
        ),
        {
          recursive: true,
        },
      ),
    ],
  ),
]);

const build =
  await Bun.build({
    entrypoints: [
      join(
        import.meta.dir,
        "browser-dispatch-batching-six-client.ts",
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
    `Could not build six-image dispatch benchmark client.\n${build.logs
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
    "Six-image dispatch benchmark client produced no bundle.",
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
    .BGCUT_BROWSER_DISPATCH_BATCHING_SIX_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser six-image dispatch bundle check passed.",
  );

  process.exit(0);
}

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
    ? sorted[middle]
    : (
        sorted[middle - 1] +
        sorted[middle]
      ) / 2;
};

const summarize = (
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
  totalMedianMs:
    median(
      runs.map(
        (run) =>
          run.timings
            .totalMs,
      ),
    ),
  outputReadbackMedianMs:
    median(
      runs.map(
        (run) =>
          run.timings
            .outputReadbackMs,
      ),
    ),
});

const changePercent = (
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

const reports =
  new Map<
    string,
    ModeReport
  >();

const runScore = async (
  outputDirectory: string,
): Promise<void> => {
  const process =
    Bun.spawn(
      [
        "bun",
        "run",
        "benchmark:score",
        "--",
        manifestPath,
        outputDirectory,
        join(
          outputDirectory,
          "quality.json",
        ),
      ],
      {
        cwd: resolve(
          import.meta.dir,
          "../..",
        ),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

  const [
    stdout,
    stderr,
    exitCode,
  ] =
    await Promise.all([
      new Response(
        process.stdout,
      ).text(),
      new Response(
        process.stderr,
      ).text(),
      process.exited,
    ]);

  if (
    exitCode !== 0
  ) {
    throw new Error(
      `Quality scorer exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }
};

const comparePixels =
  async (): Promise<PixelComparison> => {
    let absolute = 0;
    let maximum = 0;
    let differing = 0;
    let values = 0;
    let comparedRuns = 0;

    const caseResults:
      CasePixelComparison[] = [];

    for (
      const benchmarkCase of
        manifest.cases
    ) {
      let caseAbsolute = 0;
      let caseMaximum = 0;
      let caseDiffering = 0;
      let caseValues = 0;

      for (
        let run = 1;
        run <=
        runsPerCase;
        run += 1
      ) {
        const name =
          runName(
            benchmarkCase.id,
            run,
          );

        const [
          baseline,
          candidate,
        ] =
          await Promise.all([
            sharp(
              join(
                outputsRoot,
                "default",
                name,
              ),
            )
              .ensureAlpha()
              .raw()
              .toBuffer({
                resolveWithObject:
                  true,
              }),
            sharp(
              join(
                outputsRoot,
                "64",
                name,
              ),
            )
              .ensureAlpha()
              .raw()
              .toBuffer({
                resolveWithObject:
                  true,
              }),
          ]);

        if (
          baseline.info.width !==
            candidate.info.width ||
          baseline.info.height !==
            candidate.info.height ||
          baseline.info.channels !==
            4 ||
          candidate.info.channels !==
            4
        ) {
          throw new Error(
            `Default/64 dimensions differ for ${benchmarkCase.id} run ${run}.`,
          );
        }

        for (
          let index = 0;
          index <
          baseline.data.length;
          index += 1
        ) {
          const difference =
            Math.abs(
              baseline.data[
                index
              ] -
                candidate.data[
                  index
                ],
            );

          absolute +=
            difference;

          caseAbsolute +=
            difference;

          maximum =
            Math.max(
              maximum,
              difference,
            );

          caseMaximum =
            Math.max(
              caseMaximum,
              difference,
            );

          if (
            difference !== 0
          ) {
            differing += 1;
            caseDiffering += 1;
          }
        }

        values +=
          baseline.data.length;

        caseValues +=
          baseline.data.length;

        comparedRuns += 1;
      }

      caseResults.push({
        id:
          benchmarkCase.id,
        runs:
          runsPerCase,
        values:
          caseValues,
        meanAbsoluteByteDifference:
          caseAbsolute /
          caseValues,
        maxAbsoluteByteDifference:
          caseMaximum,
        differingValues:
          caseDiffering,
        differingValueFraction:
          caseDiffering /
          caseValues,
      });
    }

    return {
      schemaVersion: 1,
      comparedRuns,
      values,
      meanAbsoluteByteDifference:
        absolute / values,
      maxAbsoluteByteDifference:
        maximum,
      differingValues:
        differing,
      differingValueFraction:
        differing / values,
      cases:
        caseResults,
    };
  };

const finalize =
  async (): Promise<void> => {
    const defaultReport =
      reports.get(
        "default",
      );

    const candidateReport =
      reports.get(
        "64",
      );

    if (
      defaultReport ===
        undefined ||
      candidateReport ===
        undefined
    ) {
      throw new Error(
        "Six-image dispatch benchmark is missing a mode report.",
      );
    }

    const defaultSummary =
      summarize(
        defaultReport.runs,
      );

    const candidateSummary =
      summarize(
        candidateReport.runs,
      );

    const perCase =
      manifest.cases.map(
        (
          benchmarkCase,
        ): CaseTimingSummary => {
          const defaultRuns =
            defaultReport.runs.filter(
              (run) =>
                run.caseId ===
                benchmarkCase.id,
            );

          const candidateRuns =
            candidateReport.runs.filter(
              (run) =>
                run.caseId ===
                benchmarkCase.id,
            );

          const baseline =
            summarize(
              defaultRuns,
            );

          const candidate =
            summarize(
              candidateRuns,
            );

          return {
            id:
              benchmarkCase.id,
            default:
              baseline,
            candidate64:
              candidate,
            inferenceChangePercent:
              changePercent(
                baseline
                  .inferenceMedianMs,
                candidate
                  .inferenceMedianMs,
              ),
            totalChangePercent:
              changePercent(
                baseline
                  .totalMedianMs,
                candidate
                  .totalMedianMs,
              ),
          };
        },
      );

    await Promise.all([
      runScore(
        join(
          qualityRoot,
          "default",
        ),
      ),
      runScore(
        join(
          qualityRoot,
          "64",
        ),
      ),
    ]);

    const comparison =
      await comparePixels();

    const finalReport:
      FinalReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        strategy:
          "no-capture-reuse",
        sourceSnapshotBeforeInference:
          true,
        runsPerCase,
        cases:
          manifest.cases.length,
        summary: {
          default:
            defaultSummary,
          candidate64:
            candidateSummary,
          inferenceChangePercent:
            changePercent(
              defaultSummary
                .inferenceMedianMs,
              candidateSummary
                .inferenceMedianMs,
            ),
          totalChangePercent:
            changePercent(
              defaultSummary
                .totalMedianMs,
              candidateSummary
                .totalMedianMs,
            ),
        },
        perCase,
        reports: [
          defaultReport,
          candidateReport,
        ],
      };

    await Promise.all([
      writeJson(
        join(
          outputRoot,
          "browser-dispatch-batching-six.json",
        ),
        finalReport,
      ),
      writeJson(
        join(
          outputRoot,
          "pixel-comparison.json",
        ),
        comparison,
      ),
    ]);

    if (
      comparison.differingValues !==
      0
    ) {
      throw new Error(
        `Default and mode 64 differ at ${comparison.differingValues} RGBA values.`,
      );
    }
  };

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut six-image dispatch benchmark</title>
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
  modes,
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
          /^\/output\/(default|64)\/(\d+)\/(\d+)$/u,
        );

      if (
        request.method ===
          "POST" &&
        outputMatch !== null
      ) {
        const mode =
          Schema.decodeUnknownSync(
            ModeSchema,
          )(
            outputMatch[1] ===
              "default"
              ? "default"
              : Number.parseInt(
                  outputMatch[1],
                  10,
                ),
          );

        const caseIndex =
          Number.parseInt(
            outputMatch[2],
            10,
          );

        const runIndex =
          Number.parseInt(
            outputMatch[3],
            10,
          );

        const benchmarkCase =
          manifest.cases.at(
            caseIndex,
          );

        if (
          benchmarkCase ===
          undefined ||
          runIndex < 0 ||
          runIndex >=
            runsPerCase
        ) {
          return new Response(
            "Unknown benchmark output.",
            {
              status: 404,
            },
          );
        }

        const bytes =
          new Uint8Array(
            await request.arrayBuffer(),
          );

        const outputPath =
          join(
            outputsRoot,
            modeKey(mode),
            runName(
              benchmarkCase.id,
              runIndex + 1,
            ),
          );

        await writeFile(
          outputPath,
          bytes,
        );

        if (
          runIndex === 0
        ) {
          await writeFile(
            join(
              qualityRoot,
              modeKey(mode),
              qualityName(
                benchmarkCase.id,
              ),
            ),
            bytes,
          );
        }

        const stats =
          await sharp(
            outputPath,
          )
            .ensureAlpha()
            .stats();

        const alpha =
          stats.channels.at(3);

        if (
          alpha ===
            undefined ||
          alpha.max === 0
        ) {
          return new Response(
            `${modeKey(
              mode,
            )} output for ${benchmarkCase.id} run ${runIndex + 1} is fully transparent.`,
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
            runsRoot,
            modeKey(
              record.mode,
            ),
            `${safeCaseName(
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

        await writeJson(
          join(
            runsRoot,
            modeKey(
              record.mode,
            ),
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
          "/mode-report"
      ) {
        const report =
          Schema.decodeUnknownSync(
            ModeReportSchema,
          )(
            await request.json(),
          );

        reports.set(
          modeKey(
            report.mode,
          ),
          report,
        );

        await writeJson(
          join(
            modesRoot,
            `${modeKey(
              report.mode,
            )}.json`,
          ),
          report,
        );

        if (
          report.mode ===
          "default"
        ) {
          return Response.json({
            done: false,
            nextMode: 64,
          });
        }

        try {
          await finalize();
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          return new Response(
            message,
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
  `Safari six-image dispatch benchmark ready at http://${app.hostname}:${app.port}/ for ${manifest.cases.length} cases.`,
);
