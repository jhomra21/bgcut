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
  caseId: Schema.String,
  run: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  timings: RemovalTimingsSchema,
});

const FailureRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  caseId: Schema.String,
  run: Schema.Union(
    Schema.Number,
    Schema.Literal("prime"),
  ),
  elapsedMs: Schema.Number,
  message: Schema.String,
  stack: Schema.String,
});

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

type StageSummary = {
  readonly stage:
    | "matte"
    | "composite"
    | "exported-rgba"
    | "sharp-decoded";
  readonly comparisons: readonly Comparison[];
};

type RoundTripSummary = {
  readonly run: number;
  readonly compositeVsBrowserExport: Comparison;
  readonly browserExportVsSharpDecoded: Comparison;
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly targetCaseId: string;
  readonly runsPerCase: number;
  readonly records: readonly RunRecord[];
  readonly stages: readonly StageSummary[];
  readonly roundTrips: readonly RoundTripSummary[];
};

type PersistedRecord =
  | RunRecord
  | FailureRecord
  | FinalReport;

const usage =
  "Usage: bun run benchmark:browser-removal-stage-diagnostic -- <manifest.json> <output-dir> <model.onnx> [runs-per-case] [timeout-ms] [port] [target-case-id]";

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

const artifactRoot =
  join(
    outputRoot,
    "artifacts",
  );

const runRoot =
  join(
    outputRoot,
    "runs",
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

await Promise.all([
  mkdir(
    outputRoot,
    {
      recursive: true,
    },
  ),
  mkdir(
    artifactRoot,
    {
      recursive: true,
    },
  ),
  mkdir(
    runRoot,
    {
      recursive: true,
    },
  ),
  ...Array.from(
    {
      length:
        runsPerCase,
    },
    (
      _,
      index,
    ) =>
      mkdir(
        join(
          artifactRoot,
          `run-${index + 1}`,
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
        "browser-removal-stage-diagnostic-client.ts",
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
    `Could not build removal-stage diagnostic client.\n${build.logs
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
    "Removal-stage diagnostic client produced no bundle.",
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
    .BGCUT_BROWSER_REMOVAL_STAGE_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser removal-stage diagnostic bundle check passed.",
  );

  process.exit(0);
}

const records:
  RunRecord[] = [];

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

const artifactPath = (
  run: number,
  stage:
    | "matte"
    | "composite"
    | "exported-rgba"
    | "output-png",
): string =>
  join(
    artifactRoot,
    `run-${run}`,
    stage ===
      "output-png"
      ? "output.png"
      : `${stage}.rgba`,
  );

const readRaw = async (
  run: number,
  stage:
    | "matte"
    | "composite"
    | "exported-rgba",
): Promise<Uint8Array> =>
  new Uint8Array(
    await Bun.file(
      artifactPath(
        run,
        stage,
      ),
    ).arrayBuffer(),
  );

const readSharpDecoded =
  async (
    run: number,
  ): Promise<Uint8Array> => {
    const result =
      await sharp(
        artifactPath(
          run,
          "output-png",
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
        `Expected RGBA PNG output for run ${run}.`,
      );
    }

    return result.data;
  };

const compareBytes = (
  leftName: string,
  left: Uint8Array,
  rightName: string,
  right: Uint8Array,
): Comparison => {
  if (
    left.length !==
    right.length
  ) {
    throw new Error(
      `Byte lengths differ between ${leftName} and ${rightName}.`,
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
    left.length;
    index += 1
  ) {
    const difference =
      Math.abs(
        left[index] -
          right[index],
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
    left.length / 4;

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
      leftName,
    right:
      rightName,
    values:
      left.length,
    differingValues:
      totalDiffering,
    differingValueFraction:
      totalDiffering /
      left.length,
    maxAbsoluteByteDifference:
      totalMaximum,
    meanAbsoluteByteDifference:
      totalAbsolute /
      left.length,
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

const stageComparisons =
  async (
    stage:
      | "matte"
      | "composite"
      | "exported-rgba"
      | "sharp-decoded",
  ): Promise<
    readonly Comparison[]
  > => {
    const read =
      stage ===
      "sharp-decoded"
        ? readSharpDecoded
        : (
            run: number,
          ) =>
            readRaw(
              run,
              stage,
            );

    const rasters =
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
            read(
              index + 1,
            ),
        ),
      );

    const comparisons:
      Comparison[] = [];

    for (
      let left = 0;
      left <
      rasters.length;
      left += 1
    ) {
      for (
        let right =
          left + 1;
        right <
        rasters.length;
        right += 1
      ) {
        comparisons.push(
          compareBytes(
            `${stage}-run-${left + 1}`,
            rasters[
              left
            ],
            `${stage}-run-${right + 1}`,
            rasters[
              right
            ],
          ),
        );
      }
    }

    return comparisons;
  };

const finalize =
  async (): Promise<void> => {
    if (
      records.length !==
      runsPerCase
    ) {
      throw new Error(
        `Expected ${runsPerCase} target run records, found ${records.length}.`,
      );
    }

    const stages:
      StageSummary[] = [];

    for (
      const stage of [
        "matte",
        "composite",
        "exported-rgba",
        "sharp-decoded",
      ] as const
    ) {
      stages.push({
        stage,
        comparisons:
          await stageComparisons(
            stage,
          ),
      });
    }

    const roundTrips:
      RoundTripSummary[] = [];

    for (
      let run = 1;
      run <=
      runsPerCase;
      run += 1
    ) {
      const [
        composite,
        browserExport,
        sharpDecoded,
      ] =
        await Promise.all([
          readRaw(
            run,
            "composite",
          ),
          readRaw(
            run,
            "exported-rgba",
          ),
          readSharpDecoded(
            run,
          ),
        ]);

      roundTrips.push({
        run,
        compositeVsBrowserExport:
          compareBytes(
            `composite-run-${run}`,
            composite,
            `exported-rgba-run-${run}`,
            browserExport,
          ),
        browserExportVsSharpDecoded:
          compareBytes(
            `exported-rgba-run-${run}`,
            browserExport,
            `sharp-decoded-run-${run}`,
            sharpDecoded,
          ),
      });
    }

    const report:
      FinalReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        targetCaseId,
        runsPerCase,
        records:
          [...records].sort(
            (left, right) =>
              left.run -
              right.run,
          ),
        stages,
        roundTrips,
      };

    await writeJson(
      join(
        outputRoot,
        "browser-removal-stage-diagnostic.json",
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
    <title>bgcut removal-stage diagnostic</title>
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
          undefined ||
          caseIndex >
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

      const artifactMatch =
        url.pathname.match(
          /^\/artifact\/(\d+)\/(matte|composite|exported-rgba|output-png)$/u,
        );

      if (
        request.method ===
          "POST" &&
        artifactMatch !== null
      ) {
        const run =
          Number.parseInt(
            artifactMatch[1],
            10,
          );

        const stage =
          artifactMatch[2] as
            | "matte"
            | "composite"
            | "exported-rgba"
            | "output-png";

        if (
          run < 1 ||
          run >
            runsPerCase
        ) {
          return new Response(
            "Unknown diagnostic run.",
            {
              status: 404,
            },
          );
        }

        await writeFile(
          artifactPath(
            run,
            stage,
          ),
          new Uint8Array(
            await request.arrayBuffer(),
          ),
        );

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

        records.push(
          record,
        );

        await writeJson(
          join(
            runRoot,
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
          "/finalize"
      ) {
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

        return new Response(
          "saved",
        );
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
  `Safari removal-stage diagnostic ready at http://${app.hostname}:${app.port}/ for ${targetCaseId}.`,
);
