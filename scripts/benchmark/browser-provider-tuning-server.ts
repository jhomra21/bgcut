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
  "storage-simple",
  "combined",
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
  run: Schema.Number,
  timings: RemovalTimingsSchema,
});

const PrimeRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mode: ModeSchema,
  timings: RemovalTimingsSchema,
});

const FailureRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mode: ModeSchema,
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
  caseId: Schema.String,
  mode: ModeSchema,
  runs: Schema.Array(
    RunRecordSchema,
  ),
  prime: PrimeRecordSchema,
});

type Mode =
  Schema.Schema.Type<
    typeof ModeSchema
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

type ModeReport =
  Schema.Schema.Type<
    typeof ModeReportSchema
  >;

type TimingSummary = {
  readonly inferenceMedianMs: number;
  readonly outputReadbackMedianMs: number;
  readonly totalMedianMs: number;
};

type PixelComparison = {
  readonly left: string;
  readonly right: string;
  readonly values: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
  readonly alphaDifferences: number;
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly caseId: string;
  readonly runs: number;
  readonly summaries: Readonly<
    Record<
      Mode,
      TimingSummary
    >
  >;
  readonly reports: readonly ModeReport[];
  readonly withinMode: Readonly<
    Record<
      Mode,
      readonly PixelComparison[]
    >
  >;
  readonly versusDefault: Readonly<
    Record<
      Exclude<
        Mode,
        "default"
      >,
      readonly PixelComparison[]
    >
  >;
};

type PersistedRecord =
  | RunRecord
  | PrimeRecord
  | FailureRecord
  | ModeReport
  | FinalReport;

const usage =
  "Usage: bun run benchmark:browser-provider-tuning -- <manifest.json> <output-dir> <model.onnx> [runs] [timeout-ms] [port] [case-id]";

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  runsArgument = "3",
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

const modesRoot =
  join(
    outputRoot,
    "modes",
  );

const modelPath =
  resolve(
    modelArgument,
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
    "wgpu-only",
    "storage-simple",
    "combined",
  ];

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
    modesRoot,
    {
      recursive: true,
    },
  ),
  ...modes.map(
    (mode) =>
      mkdir(
        join(
          outputsRoot,
          mode,
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
        "browser-provider-tuning-client.ts",
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
    `Could not build provider-tuning client.\n${build.logs
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
    "Provider-tuning client produced no bundle.",
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
    .BGCUT_BROWSER_PROVIDER_TUNING_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser provider-tuning bundle check passed.",
  );

  process.exit(0);
}

const reports =
  new Map<
    Mode,
    ModeReport
  >();

const outputPath = (
  mode: Mode,
  run: number,
): string =>
  join(
    outputsRoot,
    mode,
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
  modeRuns: readonly RunRecord[],
): TimingSummary => ({
  inferenceMedianMs:
    median(
      modeRuns.map(
        (record) =>
          record.timings
            .inferenceMs,
      ),
    ),
  outputReadbackMedianMs:
    median(
      modeRuns.map(
        (record) =>
          record.timings
            .outputReadbackMs,
      ),
    ),
  totalMedianMs:
    median(
      modeRuns.map(
        (record) =>
          record.timings
            .totalMs,
      ),
    ),
});

const readRaster = async (
  mode: Mode,
  run: number,
) => {
  const result =
    await sharp(
      outputPath(
        mode,
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
      `Expected RGBA output for ${mode} run ${run}.`,
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
  leftMode: Mode,
  leftRun: number,
  rightMode: Mode,
  rightRun: number,
): Promise<PixelComparison> => {
  const [
    left,
    right,
  ] =
    await Promise.all([
      readRaster(
        leftMode,
        leftRun,
      ),
      readRaster(
        rightMode,
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
      `Dimensions differ between ${leftMode} run ${leftRun} and ${rightMode} run ${rightRun}.`,
    );
  }

  let absolute = 0;

  let maximum = 0;

  let differing = 0;

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
      difference !== 0
    ) {
      differing += 1;

      if (
        index % 4 ===
        3
      ) {
        alphaDifferences +=
          1;
      }
    }
  }

  return {
    left:
      `${leftMode}-run-${leftRun}`,
    right:
      `${rightMode}-run-${rightRun}`,
    values:
      left.data.length,
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
  };
};

const compareWithinMode =
  async (
    mode: Mode,
  ): Promise<
    readonly PixelComparison[]
  > => {
    const comparisons:
      PixelComparison[] = [];

    for (
      let left = 1;
      left <= runs;
      left += 1
    ) {
      for (
        let right =
          left + 1;
        right <= runs;
        right += 1
      ) {
        comparisons.push(
          await compare(
            mode,
            left,
            mode,
            right,
          ),
        );
      }
    }

    return comparisons;
  };

const compareToDefault =
  async (
    mode: Exclude<
      Mode,
      "default"
    >,
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
          compare(
            "default",
            1,
            mode,
            index + 1,
          ),
      ),
    );

const finalize =
  async (): Promise<void> => {
    const defaultReport =
      reports.get(
        "default",
      );

    const wgpuOnly =
      reports.get(
        "wgpu-only",
      );

    const storageSimple =
      reports.get(
        "storage-simple",
      );

    const combined =
      reports.get(
        "combined",
      );

    if (
      defaultReport ===
        undefined ||
      wgpuOnly ===
        undefined ||
      storageSimple ===
        undefined ||
      combined ===
        undefined
    ) {
      throw new Error(
        "Provider-tuning benchmark is missing a mode report.",
      );
    }

    const report:
      FinalReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        caseId,
        runs,
        summaries: {
          default:
            summarize(
              defaultReport.runs,
            ),
          "wgpu-only":
            summarize(
              wgpuOnly.runs,
            ),
          "storage-simple":
            summarize(
              storageSimple.runs,
            ),
          combined:
            summarize(
              combined.runs,
            ),
        },
        reports: [
          defaultReport,
          wgpuOnly,
          storageSimple,
          combined,
        ],
        withinMode: {
          default:
            await compareWithinMode(
              "default",
            ),
          "wgpu-only":
            await compareWithinMode(
              "wgpu-only",
            ),
          "storage-simple":
            await compareWithinMode(
              "storage-simple",
            ),
          combined:
            await compareWithinMode(
              "combined",
            ),
        },
        versusDefault: {
          "wgpu-only":
            await compareToDefault(
              "wgpu-only",
            ),
          "storage-simple":
            await compareToDefault(
              "storage-simple",
            ),
          combined:
            await compareToDefault(
              "combined",
            ),
        },
      };

    await writeJson(
      join(
        outputRoot,
        "browser-provider-tuning.json",
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
    <title>bgcut WebGPU provider tuning</title>
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

      const outputMatch =
        url.pathname.match(
          /^\/output\/(default|wgpu-only|storage-simple|combined)\/(\d+)$/u,
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
            outputMatch[1],
          );

        const run =
          Number.parseInt(
            outputMatch[2],
            10,
          );

        if (
          run < 1 ||
          run > runs
        ) {
          return new Response(
            "Unknown provider-tuning run.",
            {
              status: 404,
            },
          );
        }

        const targetPath =
          outputPath(
            mode,
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
          alpha === undefined ||
          alpha.max === 0
        ) {
          return new Response(
            `${mode} run ${run} is fully transparent.`,
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
            record.mode,
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
            record.mode,
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
          "/mode-report"
      ) {
        const report =
          Schema.decodeUnknownSync(
            ModeReportSchema,
          )(
            await request.json(),
          );

        reports.set(
          report.mode,
          report,
        );

        await writeJson(
          join(
            modesRoot,
            `${report.mode}.json`,
          ),
          report,
        );

        const modeIndex =
          modes.indexOf(
            report.mode,
          );

        const nextMode =
          modes[
            modeIndex + 1
          ];

        if (
          nextMode !==
          undefined
        ) {
          return Response.json({
            done: false,
            nextMode,
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
  `Safari provider-tuning benchmark ready at http://${app.hostname}:${app.port}/ for ${benchmarkCase.id}.`,
);
