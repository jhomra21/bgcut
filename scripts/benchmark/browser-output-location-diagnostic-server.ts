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

const DiagnosticStageSchema = Schema.Literal(
  "session-ready",
  "inference-start",
  "inference-complete",
  "matte-complete",
  "composite-complete",
  "export-complete",
);

const LastStageSchema = Schema.Union(
  DiagnosticStageSchema,
  Schema.Literal(
    "attempt-start",
  ),
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

const AttemptStartSchema = Schema.Struct({
  label: Schema.String,
  caseId: Schema.String,
  expectReuse: Schema.Boolean,
  startedAt: Schema.String,
});

const ProgressSchema = Schema.Struct({
  label: Schema.String,
  stage: DiagnosticStageSchema,
  elapsedMs: Schema.Number,
  recordedAt: Schema.String,
});

const RunRecordSchema = Schema.Struct({
  label: Schema.String,
  lastStage: LastStageSchema,
  elapsedMs: Schema.Number,
  timings: RemovalTimingsSchema,
});

const FailureRecordSchema = Schema.Struct({
  label: Schema.String,
  caseId: Schema.String,
  lastStage: LastStageSchema,
  elapsedMs: Schema.Number,
  message: Schema.String,
  stack: Schema.String,
});

const DiagnosticReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  userAgent: Schema.String,
  caseId: Schema.String,
  outputLocation: Schema.Literal(
    "cpu",
  ),
  strategy: Schema.Literal(
    "no-capture-reuse",
  ),
  timeoutMs: Schema.Number,
  attempts: Schema.Array(
    RunRecordSchema,
  ),
});

type PersistedDiagnostic =
  | Schema.Schema.Type<
      typeof AttemptStartSchema
    >
  | Schema.Schema.Type<
      typeof ProgressSchema
    >
  | Schema.Schema.Type<
      typeof RunRecordSchema
    >
  | Schema.Schema.Type<
      typeof FailureRecordSchema
    >
  | Schema.Schema.Type<
      typeof DiagnosticReportSchema
    >;

const usage =
  "Usage: bun run benchmark:browser-output-location:diagnostic -- <manifest.json> <output-dir> <model.onnx> [measured-runs] [timeout-ms] [port] [case-id]";

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  measuredRunsArgument = "3",
  timeoutArgument = "60000",
  portArgument = "4188",
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

const progressDirectory =
  join(
    outputRoot,
    "progress",
  );

const attemptDirectory =
  join(
    outputRoot,
    "attempts",
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
      candidate.id === caseId,
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
    progressDirectory,
    {
      recursive: true,
    },
  ),
  mkdir(
    attemptDirectory,
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
        "browser-output-location-diagnostic-client.ts",
      ),
    ],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
  });

if (!build.success) {
  throw new Error(
    `Could not build CPU-output diagnostic client.\n${build.logs
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
    "CPU-output diagnostic client produced no bundle.",
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
    .BGCUT_BROWSER_OUTPUT_LOCATION_DIAGNOSTIC_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser output-location diagnostic bundle check passed.",
  );

  process.exit(0);
}

const safeLabel = (
  label: string,
): string =>
  label
    .replaceAll("/", "__")
    .replaceAll("\\", "__");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut Safari CPU-output diagnostic</title>
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
};

let progressIndex = 0;

const writeJson = async (
  path: string,
  value: PersistedDiagnostic,
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
          "/attempt"
      ) {
        const value =
          Schema.decodeUnknownSync(
            AttemptStartSchema,
          )(
            await request.json(),
          );

        const label =
          safeLabel(
            value.label,
          );

        await writeJson(
          join(
            attemptDirectory,
            `${label}.json`,
          ),
          value,
        );

        return new Response(
          "saved",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/progress"
      ) {
        const progress =
          Schema.decodeUnknownSync(
            ProgressSchema,
          )(
            await request.json(),
          );

        progressIndex += 1;

        const filename =
          `${String(
            progressIndex,
          ).padStart(
            4,
            "0",
          )}-${safeLabel(
            progress.label,
          )}-${safeLabel(
            progress.stage,
          )}.json`;

        await Promise.all([
          writeJson(
            join(
              progressDirectory,
              filename,
            ),
            progress,
          ),
          writeJson(
            join(
              outputRoot,
              "latest-progress.json",
            ),
            progress,
          ),
        ]);

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
        const value =
          Schema.decodeUnknownSync(
            RunRecordSchema,
          )(
            await request.json(),
          );

        const label =
          safeLabel(
            value.label,
          );

        await writeJson(
          join(
            runDirectory,
            `${label}.json`,
          ),
          value,
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
          "/report"
      ) {
        const report =
          Schema.decodeUnknownSync(
            DiagnosticReportSchema,
          )(
            await request.json(),
          );

        await writeJson(
          join(
            outputRoot,
            "browser-output-location-diagnostic.json",
          ),
          report,
        );

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
  `Safari CPU-output diagnostic ready at http://${app.hostname}:${app.port}/ for ${benchmarkCase.id}.`,
);
