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

const PendingDispatchesSchema = Schema.Union(
  Schema.Literal("default"),
  Schema.Literal(8),
  Schema.Literal(32),
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
  label: Schema.String,
  mode: PendingDispatchesSchema,
  run: Schema.Number,
  prime: Schema.Boolean,
  elapsedMs: Schema.Number,
  timings: RemovalTimingsSchema,
});

const FailureRecordSchema = Schema.Struct({
  label: Schema.String,
  mode: PendingDispatchesSchema,
  run: Schema.Number,
  prime: Schema.Boolean,
  elapsedMs: Schema.Number,
  message: Schema.String,
  stack: Schema.String,
});

const ModeReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  userAgent: Schema.String,
  caseId: Schema.String,
  strategy: Schema.Literal(
    "no-capture-reuse",
  ),
  mode: PendingDispatchesSchema,
  timeoutMs: Schema.Number,
  attempts: Schema.Array(
    RunRecordSchema,
  ),
});

type ModeReport =
  Schema.Schema.Type<
    typeof ModeReportSchema
  >;

type PendingDispatches =
  Schema.Schema.Type<
    typeof PendingDispatchesSchema
  >;

type SummaryRecord = {
  readonly mode: PendingDispatches;
  readonly inferenceMedianMs: number;
  readonly totalMedianMs: number;
  readonly outputReadbackMedianMs: number;
};

type ComparisonRecord = {
  readonly mode: Exclude<
    PendingDispatches,
    "default"
  >;
  readonly values: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly caseId: string;
  readonly strategy: "no-capture-reuse";
  readonly measuredRuns: number;
  readonly timeoutMs: number;
  readonly modes: readonly PendingDispatches[];
  readonly summary: readonly SummaryRecord[];
  readonly reports: readonly ModeReport[];
};

type PixelComparisonReport = {
  readonly schemaVersion: 1;
  readonly baseline: "default";
  readonly comparisons: readonly ComparisonRecord[];
};

type PersistedRecord =
  | ModeReport
  | Schema.Schema.Type<
      typeof RunRecordSchema
    >
  | Schema.Schema.Type<
      typeof FailureRecordSchema
    >
  | FinalReport
  | PixelComparisonReport;

const usage =
  "Usage: bun run benchmark:browser-dispatch-batching -- <manifest.json> <output-dir> <model.onnx> [measured-runs] [timeout-ms] [port] [case-id]";

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  measuredRunsArgument = "3",
  timeoutArgument = "60000",
  portArgument = "4184",
  caseId = "cat-in-sink",
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

const modeDirectory =
  join(
    outputRoot,
    "modes",
  );

const modelPath =
  resolve(
    modelArgument,
  );

const measuredRuns =
  Number.parseInt(
    measuredRunsArgument,
    10,
  );

if (
  !Number.isInteger(
    measuredRuns,
  ) ||
  measuredRuns < 1
) {
  throw new Error(
    `Measured runs must be a positive integer, received "${measuredRunsArgument}".`,
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
  benchmarkCase ===
  undefined
) {
  throw new Error(
    `Benchmark case "${caseId}" was not found in the manifest.`,
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

await Promise.all([
  mkdir(
    outputRoot,
    {
      recursive: true,
    },
  ),
  mkdir(
    outputDirectory,
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
    modeDirectory,
    {
      recursive: true,
    },
  ),
]);

const build =
  await Bun.build({
    entrypoints: [
      join(
        import.meta.dir,
        "browser-dispatch-batching-client.ts",
      ),
    ],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
  });

if (!build.success) {
  throw new Error(
    `Could not build dispatch-batching benchmark client.\n${build.logs
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
    "Dispatch-batching benchmark client produced no bundle.",
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
    .BGCUT_BROWSER_DISPATCH_BATCHING_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser dispatch-batching bundle check passed.",
  );

  process.exit(0);
}

const modes:
  readonly PendingDispatches[] = [
    "default",
    8,
    32,
    64,
  ];

const modeKey = (
  mode: PendingDispatches,
): string =>
  String(mode);

const safeLabel = (
  label: string,
): string =>
  label
    .replaceAll("/", "__")
    .replaceAll("\\", "__");

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

const reports =
  new Map<
    string,
    ModeReport
  >();

const compareOutputs =
  async (
    candidate:
      Exclude<
        PendingDispatches,
        "default"
      >,
  ): Promise<ComparisonRecord> => {
    const [
      baseline,
      candidateOutput,
    ] =
      await Promise.all([
        sharp(
          join(
            outputDirectory,
            "default-run-1.png",
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
            outputDirectory,
            `${modeKey(
              candidate,
            )}-run-1.png`,
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
        candidateOutput.info.width ||
      baseline.info.height !==
        candidateOutput.info.height ||
      baseline.info.channels !==
        4 ||
      candidateOutput.info.channels !==
        4
    ) {
      throw new Error(
        `Output dimensions differ for dispatch mode ${modeKey(
          candidate,
        )}.`,
      );
    }

    let absolute = 0;
    let maximum = 0;
    let differing = 0;

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
            candidateOutput.data[
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
      }
    }

    const values =
      baseline.data.length;

    return {
      mode:
        candidate,
      values,
      meanAbsoluteByteDifference:
        absolute / values,
      maxAbsoluteByteDifference:
        maximum,
      differingValues:
        differing,
      differingValueFraction:
        differing / values,
    };
  };

const finalize =
  async (): Promise<void> => {
    const orderedReports =
      modes.map(
        (mode) => {
          const report =
            reports.get(
              modeKey(mode),
            );

          if (
            report === undefined
          ) {
            throw new Error(
              `Missing report for dispatch mode ${modeKey(
                mode,
              )}.`,
            );
          }

          return report;
        },
      );

    const summary =
      orderedReports.map(
        (report) => {
          const warm =
            report.attempts.filter(
              (attempt) =>
                !attempt.prime,
            );

          return {
            mode:
              report.mode,
            inferenceMedianMs:
              median(
                warm.map(
                  (attempt) =>
                    attempt.timings
                      .inferenceMs,
                ),
              ),
            totalMedianMs:
              median(
                warm.map(
                  (attempt) =>
                    attempt.timings
                      .totalMs,
                ),
              ),
            outputReadbackMedianMs:
              median(
                warm.map(
                  (attempt) =>
                    attempt.timings
                      .outputReadbackMs,
                ),
              ),
          };
        },
      );

    const comparisons =
      await Promise.all(
        modes.flatMap(
          (mode) =>
            mode === "default"
              ? []
              : [
                  compareOutputs(
                    mode,
                  ),
                ],
        ),
      );

    await Promise.all([
      writeJson(
        join(
          outputRoot,
          "browser-dispatch-batching.json",
        ),
        {
          schemaVersion: 1,
          generatedAt:
            new Date().toISOString(),
          caseId:
            benchmarkCase.id,
          strategy:
            "no-capture-reuse",
          measuredRuns,
          timeoutMs,
          modes,
          summary,
          reports:
            orderedReports,
        } satisfies FinalReport,
      ),
      writeJson(
        join(
          outputRoot,
          "pixel-comparison.json",
        ),
        {
          schemaVersion: 1,
          baseline:
            "default",
          comparisons,
        } satisfies PixelComparisonReport,
      ),
    ]);
  };

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut WebGPU dispatch batching benchmark</title>
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
  measuredRuns,
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
            `${safeLabel(
              record.label,
            )}.json`,
          ),
          record,
        );

        return new Response(
          "saved",
        );
      }

      const outputMatch =
        url.pathname.match(
          /^\/output\/([^/]+)$/u,
        );

      if (
        request.method ===
          "POST" &&
        outputMatch !== null
      ) {
        const label =
          safeLabel(
            outputMatch[1],
          );

        const targetPath =
          join(
            outputDirectory,
            `${label}.png`,
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
          alpha === undefined ||
          alpha.max === 0
        ) {
          return new Response(
            `${label} output is fully transparent.`,
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

        const key =
          modeKey(
            report.mode,
          );

        reports.set(
          key,
          report,
        );

        await writeJson(
          join(
            modeDirectory,
            `${key}.json`,
          ),
          report,
        );

        const index =
          modes.findIndex(
            (mode) =>
              modeKey(mode) ===
              key,
          );

        if (
          index < 0
        ) {
          return new Response(
            "Unknown dispatch-batching mode.",
            {
              status: 422,
            },
          );
        }

        const nextMode =
          modes.at(
            index + 1,
          );

        if (
          nextMode !==
          undefined
        ) {
          return Response.json({
            done: false,
            nextMode,
          });
        }

        await finalize();

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
  `Safari dispatch-batching benchmark ready at http://${app.hostname}:${app.port}/ for ${benchmarkCase.id}.`,
);
