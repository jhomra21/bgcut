import { Schema } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const BenchmarkManifestSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
});

const QualityMetricSchema = Schema.Struct({
  id: Schema.String,
  pixels: Schema.Number,
  mae: Schema.Number,
  mse: Schema.Number,
  iou: Schema.Number,
  f1: Schema.Number,
});

const QualityReportSchema = Schema.Struct({
  schemaVersion: Schema.Number,
  outputDirectory: Schema.String,
  metrics: Schema.Struct({
    mae: Schema.String,
    mse: Schema.String,
    iou: Schema.String,
    f1: Schema.String,
  }),
  aggregate: QualityMetricSchema,
  cases: Schema.Array(QualityMetricSchema),
});

const BrowserFailureSchema = Schema.Struct({
  message: Schema.String,
  diagnosticSessionCreated: Schema.Boolean,
  diagnosticSessionError: Schema.String,
  logs: Schema.Array(Schema.String),
});

const usage =
  "Usage: bun run benchmark:browser-candidate -- <manifest.json> <output-dir> <model.onnx> <input-size> [warm-repeats] [port]";

const parsePositiveInteger = (value: string, label: string): number => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer, received "${value}".`);
  }

  return parsed;
};

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  inputSizeArgument,
  repeatsArgument = "5",
  portArgument = "4177",
] = process.argv.slice(2);

if (
  manifestArgument === undefined ||
  outputArgument === undefined ||
  modelArgument === undefined ||
  inputSizeArgument === undefined
) {
  throw new Error(usage);
}

const manifestPath = resolve(manifestArgument);

const manifestRoot = dirname(manifestPath);

const outputRoot = resolve(outputArgument);

const modelPath = resolve(modelArgument);

const modelFile = Bun.file(modelPath);

if (!(await modelFile.exists())) {
  throw new Error(`Candidate model does not exist at ${modelPath}.`);
}

const inputSize = parsePositiveInteger(inputSizeArgument, "Input size");

const warmRepeats = parsePositiveInteger(repeatsArgument, "Warm repeats");

const port = parsePositiveInteger(portArgument, "Port");

const manifest = Schema.decodeUnknownSync(BenchmarkManifestSchema)(
  JSON.parse(await readFile(manifestPath, "utf8")),
);

if (manifest.cases.length === 0) {
  throw new Error("Benchmark manifest must contain at least one case.");
}

await mkdir(outputRoot, { recursive: true });

const clientEntry = join(
  import.meta.dir,
  "browser-candidate-client.ts",
);

const ortSourceEntry = resolve(
  import.meta.dir,
  "../../node_modules/onnxruntime-web/lib/index.ts",
);

const ortProviderPatchPlugin = {
  name: "bgcut-ort-webgpu-provider-options",
  setup(build: {
    onResolve(
      options: { filter: RegExp },
      callback: (args: { path: string }) => { path: string } | undefined,
    ): void;
    onLoad(
      options: { filter: RegExp },
      callback: (args: { path: string }) => Promise<{
        contents: string;
        loader: "ts";
      }>,
    ): void;
  }): void {
    build.onResolve(
      { filter: /^onnxruntime-web\/webgpu$/u },
      () => ({ path: ortSourceEntry }),
    );

    build.onLoad(
      { filter: /onnxruntime-web\/lib\/wasm\/session-options\.ts$/u },
      async (args) => {

        const source = await readFile(args.path, "utf8");

        const anchor =
          "            // set graph capture option from session options\n";

        if (!source.includes(anchor)) {
          throw new Error(
            `Could not locate ONNX Runtime WebGPU provider-option anchor in ${args.path}.`,
          );
        }

        const patch = [
          "            const enableInt64 =",
          "              (webgpuOptions as { readonly enableInt64?: boolean }).enableInt64;",
          "",
          "            if (typeof enableInt64 === 'boolean') {",
          "              appendEpOption(epOptions, 'enableInt64', enableInt64 ? '1' : '0', allocs);",
          "            }",
          "",
        ].join("\n");

        return {
          contents: source.replace(anchor, patch + anchor),
          loader: "ts",
        };
      },
    );
  },
};

const build = await Bun.build({
  entrypoints: [clientEntry],
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "inline",
  plugins: [ortProviderPatchPlugin],
  define: {
    "BUILD_DEFS.DISABLE_WEBGL": "true",
    "BUILD_DEFS.DISABLE_JSEP": "true",
    "BUILD_DEFS.DISABLE_WEBGPU": "false",
    "BUILD_DEFS.DISABLE_WEBNN": "true",
    "BUILD_DEFS.DISABLE_WASM": "false",
    "BUILD_DEFS.DISABLE_WASM_PROXY": "true",
    "BUILD_DEFS.ENABLE_JSPI": "false",
    "BUILD_DEFS.ENABLE_BUNDLE_WASM_JS": "false",
    "BUILD_DEFS.IS_ESM": "true",
    "BUILD_DEFS.ESM_IMPORT_META_URL": "undefined",
    "BUILD_DEFS.BUNDLE_FILENAME": "\"client.js\"",
  },
});

if (!build.success) {
  const messages = build.logs.map((log) => log.message).join("\n");

  throw new Error(`Could not build browser benchmark client.\n${messages}`);
}

const clientOutput = build.outputs.at(0);

if (clientOutput === undefined) {
  throw new Error("Browser benchmark client produced no bundle.");
}

const clientSource = await clientOutput.text();

const runtimePath = resolve(
  import.meta.dir,
  "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
);

const runtimeModulePath = resolve(
  import.meta.dir,
  "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs",
);

const runtimeFile = Bun.file(runtimePath);

const runtimeModuleFile = Bun.file(runtimeModulePath);

if (!(await runtimeFile.exists())) {
  throw new Error(`ONNX Runtime WebGPU runtime is missing at ${runtimePath}.`);
}

if (!(await runtimeModuleFile.exists())) {
  throw new Error(
    `ONNX Runtime WebGPU runtime module is missing at ${runtimeModulePath}.`,
  );
}

const safeOutputName = (id: string): string =>
  `${id.replaceAll("/", "__").replaceAll("\\", "__")}.png`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bgcut browser candidate benchmark</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      body {
        max-width: 920px;
        margin: 40px auto;
        padding: 0 24px;
      }

      pre {
        white-space: pre-wrap;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <h1>bgcut browser candidate benchmark</h1>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const config = {
  modelUrl: "/model.onnx",
  runtimeUrl: "/runtime/ort-wasm-simd-threaded.asyncify.wasm",
  runtimeModuleUrl: "/runtime/ort-wasm-simd-threaded.asyncify.mjs",
  inputSize,
  warmRepeats,
  cases: manifest.cases.map((benchmarkCase, index) => ({
    id: benchmarkCase.id,
    inputUrl: `/input/${index}`,
  })),
};

const scoreOutputs = async () => {
  const qualityPath = join(outputRoot, "quality.json");

  const process = Bun.spawn(
    [
      "bun",
      "run",
      "benchmark:score",
      "--",
      manifestPath,
      outputRoot,
      qualityPath,
    ],
    {
      cwd: resolve(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdout = await new Response(process.stdout).text();
  const stderr = await new Response(process.stderr).text();
  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(
      `Quality scorer exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }

  return Schema.decodeUnknownSync(QualityReportSchema)(
    JSON.parse(await readFile(qualityPath, "utf8")),
  );
};

const app = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/client.js") {
      return new Response(clientSource, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/config.json") {
      return Response.json(config);
    }

    if (request.method === "GET" && url.pathname === "/model.onnx") {
      return new Response(modelFile, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/runtime/ort-wasm-simd-threaded.asyncify.wasm"
    ) {
      return new Response(runtimeFile, {
        headers: {
          "content-type": "application/wasm",
          "cache-control": "no-store",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/runtime/ort-wasm-simd-threaded.asyncify.mjs"
    ) {
      return new Response(runtimeModuleFile, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    const inputMatch = url.pathname.match(/^\/input\/(\d+)$/u);

    if (request.method === "GET" && inputMatch !== null) {
      const index = Number.parseInt(inputMatch[1], 10);
      const benchmarkCase = manifest.cases.at(index);

      if (benchmarkCase === undefined) {
        return new Response("Unknown benchmark input.", { status: 404 });
      }

      return new Response(
        Bun.file(resolve(manifestRoot, benchmarkCase.input)),
        {
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    }

    const outputMatch = url.pathname.match(/^\/output\/(\d+)$/u);

    if (request.method === "POST" && outputMatch !== null) {
      const index = Number.parseInt(outputMatch[1], 10);
      const benchmarkCase = manifest.cases.at(index);

      if (benchmarkCase === undefined) {
        return new Response("Unknown benchmark output.", { status: 404 });
      }

      const bytes = new Uint8Array(await request.arrayBuffer());

      await writeFile(
        join(outputRoot, safeOutputName(benchmarkCase.id)),
        bytes,
      );

      return new Response("saved");
    }

    if (request.method === "POST" && url.pathname === "/failure") {
      const failure = Schema.decodeUnknownSync(BrowserFailureSchema)(
        await request.json(),
      );

      await writeFile(
        join(outputRoot, "browser-failure.json"),
        `${JSON.stringify(failure, null, 2)}\n`,
      );

      return new Response("failure recorded");
    }

    if (request.method === "POST" && url.pathname === "/report") {
      const report = await request.json();
      const reportPath = join(outputRoot, "browser-timings.json");

      await writeFile(
        reportPath,
        `${JSON.stringify(report, null, 2)}\n`,
      );

      try {
        const quality = await scoreOutputs();

        return Response.json({
          reportPath,
          qualityPath: join(outputRoot, "quality.json"),
          quality,
        });
      } catch (error) {
        return new Response(
          error instanceof Error ? error.message : String(error),
          { status: 500 },
        );
      }
    }

    return new Response("Not found.", { status: 404 });
  },
});

console.log("");

console.log("Browser candidate benchmark is ready.");

console.log(`Open http://${app.hostname}:${app.port}/ in Chrome.`);

console.log(`Outputs: ${outputRoot}`);

console.log("Keep this process running until the page reports completion.");
