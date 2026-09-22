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
  cases: Schema.Array(BenchmarkCaseSchema),
});

type PixelComparison = {
  readonly schemaVersion: 1;
  readonly values: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
};

const usage =
  "Usage: bun run benchmark:browser-strategy -- <manifest.json> <output-dir> <model.onnx> [runs-per-case] [port]";

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  runsArgument = "3",
  portArgument = "4184",
] = process.argv.slice(2);

if (
  manifestArgument === undefined ||
  outputArgument === undefined ||
  modelArgument === undefined
) {
  throw new Error(usage);
}

const manifestPath = resolve(manifestArgument);

const manifestRoot = dirname(manifestPath);

const outputRoot = resolve(outputArgument);

const productionOutputRoot = join(
  outputRoot,
  "production-default",
);

const captureOutputRoot = join(
  outputRoot,
  "capture-reference",
);

const modelPath = resolve(modelArgument);

const runsPerCase = Number.parseInt(
  runsArgument,
  10,
);

if (
  !Number.isInteger(runsPerCase) ||
  runsPerCase < 1
) {
  throw new Error(
    `Runs per case must be a positive integer, received "${runsArgument}".`,
  );
}

const port = Number.parseInt(portArgument, 10);

if (!Number.isInteger(port) || port < 1) {
  throw new Error(
    `Port must be a positive integer, received "${portArgument}".`,
  );
}

const manifest = Schema.decodeUnknownSync(
  BenchmarkManifestSchema,
)(
  JSON.parse(
    await readFile(manifestPath, "utf8"),
  ),
);

if (manifest.cases.length === 0) {
  throw new Error(
    "Safari validation manifest must contain at least one case.",
  );
}

const modelFile = Bun.file(modelPath);

if (!(await modelFile.exists())) {
  throw new Error(
    `Production model does not exist at ${modelPath}.`,
  );
}

await Promise.all([
  mkdir(outputRoot, { recursive: true }),
  mkdir(productionOutputRoot, { recursive: true }),
  mkdir(captureOutputRoot, { recursive: true }),
]);

const build = await Bun.build({
  entrypoints: [
    join(
      import.meta.dir,
      "browser-strategy-client.ts",
    ),
  ],
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "inline",
});

if (!build.success) {
  throw new Error(
    `Could not build Safari validation client.\n${build.logs
      .map((log) => log.message)
      .join("\n")}`,
  );
}

const clientOutput = build.outputs.at(0);

if (clientOutput === undefined) {
  throw new Error(
    "Safari validation client produced no bundle.",
  );
}

const clientSource = await clientOutput.text();

const runtimePath = resolve(
  import.meta.dir,
  "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
);

const runtimeFile = Bun.file(runtimePath);

if (!(await runtimeFile.exists())) {
  throw new Error(
    `ONNX Runtime WebGPU runtime is missing at ${runtimePath}.`,
  );
}

if (
  process.env.BGCUT_BROWSER_STRATEGY_BUILD_ONLY === "1"
) {
  console.log(
    "Browser strategy bundle check passed.",
  );

  process.exit(0);
}

const safeOutputName = (id: string): string =>
  `${id
    .replaceAll("/", "__")
    .replaceAll("\\", "__")}.png`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut Safari production validation</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const config = {
  runsPerCase,
  cases: manifest.cases.map(
    (benchmarkCase, index) => ({
      id: benchmarkCase.id,
      inputUrl: `/input/${index}`,
    }),
  ),
};

const runScore = async (
  outputDirectory: string,
): Promise<void> => {
  const process = Bun.spawn(
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
      cwd: resolve(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdout =
    await new Response(process.stdout).text();

  const stderr =
    await new Response(process.stderr).text();

  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(
      `Quality scorer exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }
};

const compareOutputs = async (): Promise<PixelComparison> => {
  let absolute = 0;
  let maximum = 0;
  let differing = 0;
  let values = 0;

  for (const benchmarkCase of manifest.cases) {
    const name = safeOutputName(benchmarkCase.id);
    const [production, capture] = await Promise.all([
      sharp(
        join(
          productionOutputRoot,
          name,
        ),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(
        join(
          captureOutputRoot,
          name,
        ),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ]);

    if (
      production.info.width !== capture.info.width ||
      production.info.height !== capture.info.height ||
      production.info.channels !== 4 ||
      capture.info.channels !== 4
    ) {
      throw new Error(
        `Production/capture dimensions differ for ${benchmarkCase.id}.`,
      );
    }

    for (
      let index = 0;
      index < production.data.length;
      index += 1
    ) {
      const difference = Math.abs(
        production.data[index] -
        capture.data[index],
      );

      absolute += difference;
      maximum = Math.max(
        maximum,
        difference,
      );

      if (difference !== 0) {
        differing += 1;
      }
    }

    values += production.data.length;
  }

  return {
    schemaVersion: 1,
    values,
    meanAbsoluteByteDifference:
      absolute / values,
    maxAbsoluteByteDifference: maximum,
    differingValues: differing,
    differingValueFraction:
      differing / values,
  };
};

const app = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return new Response(html, {
        headers: {
          "content-type":
            "text/html; charset=utf-8",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/client.js"
    ) {
      return new Response(clientSource, {
        headers: {
          "content-type":
            "text/javascript; charset=utf-8",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/config.json"
    ) {
      return Response.json(config);
    }

    if (
      request.method === "GET" &&
      url.pathname === MODEL_PUBLIC_PATH
    ) {
      return new Response(modelFile, {
        headers: {
          "content-type":
            "application/octet-stream",
          "cache-control": "no-store",
          "x-bgcut-model": MODEL_FILENAME,
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === ORT_WEBGPU_WASM_PUBLIC_PATH
    ) {
      return new Response(runtimeFile, {
        headers: {
          "content-type": "application/wasm",
          "cache-control": "no-store",
        },
      });
    }

    const inputMatch =
      url.pathname.match(/^\/input\/(\d+)$/u);

    if (
      request.method === "GET" &&
      inputMatch !== null
    ) {
      const index = Number.parseInt(
        inputMatch[1],
        10,
      );
      const benchmarkCase =
        manifest.cases.at(index);

      if (benchmarkCase === undefined) {
        return new Response(
          "Unknown benchmark input.",
          { status: 404 },
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
            "cache-control": "no-store",
          },
        },
      );
    }

    const outputMatch =
      url.pathname.match(
        /^\/output\/(production-default|capture-reference)\/(\d+)$/u,
      );

    if (
      request.method === "POST" &&
      outputMatch !== null
    ) {
      const mode = outputMatch[1];
      const index = Number.parseInt(
        outputMatch[2],
        10,
      );
      const benchmarkCase =
        manifest.cases.at(index);

      if (benchmarkCase === undefined) {
        return new Response(
          "Unknown benchmark output.",
          { status: 404 },
        );
      }

      const targetRoot =
        mode === "production-default"
          ? productionOutputRoot
          : captureOutputRoot;
      const targetPath = join(
        targetRoot,
        safeOutputName(benchmarkCase.id),
      );

      await writeFile(
        targetPath,
        new Uint8Array(
          await request.arrayBuffer(),
        ),
      );

      const stats = await sharp(targetPath)
        .ensureAlpha()
        .stats();

      const alpha = stats.channels.at(3);

      if (alpha === undefined || alpha.max === 0) {
        return new Response(
          `${mode} output for ${benchmarkCase.id} is fully transparent.`,
          { status: 422 },
        );
      }

      return new Response("saved");
    }

    const runMatch =
      url.pathname.match(
        /^\/run\/(production-default|capture-reference)\/(\d+)\/(\d+)$/u,
      );

    if (
      request.method === "POST" &&
      runMatch !== null
    ) {
      const mode = runMatch[1];
      const caseIndex = Number.parseInt(
        runMatch[2],
        10,
      );
      const runIndex = Number.parseInt(
        runMatch[3],
        10,
      );
      const benchmarkCase =
        manifest.cases.at(caseIndex);

      if (benchmarkCase === undefined) {
        return new Response(
          "Unknown timing case.",
          { status: 404 },
        );
      }

      const timingRoot = join(
        outputRoot,
        "runs",
        mode,
      );

      await mkdir(
        timingRoot,
        { recursive: true },
      );

      await writeFile(
        join(
          timingRoot,
          `${safeOutputName(
            benchmarkCase.id,
          ).replace(/\.png$/u, "")}-run-${runIndex + 1}.json`,
        ),
        `${JSON.stringify(
          await request.json(),
          null,
          2,
        )}\n`,
      );

      return new Response("saved");
    }

    if (
      request.method === "POST" &&
      url.pathname === "/failure"
    ) {
      await writeFile(
        join(
          outputRoot,
          "browser-failure.json",
        ),
        `${JSON.stringify(
          await request.json(),
          null,
          2,
        )}\n`,
      );

      return new Response("failure recorded");
    }

    if (
      request.method === "POST" &&
      url.pathname === "/report"
    ) {
      await writeFile(
        join(
          outputRoot,
          "browser-strategies.json",
        ),
        `${JSON.stringify(
          await request.json(),
          null,
          2,
        )}\n`,
      );

      await runScore(productionOutputRoot);
      await runScore(captureOutputRoot);

      const comparison =
        await compareOutputs();

      await writeFile(
        join(
          outputRoot,
          "pixel-comparison.json",
        ),
        `${JSON.stringify(
          comparison,
          null,
          2,
        )}\n`,
      );

      return new Response("saved");
    }

    return new Response(
      "Not found.",
      { status: 404 },
    );
  },
});

console.log(
  `Safari production validation ready at http://${app.hostname}:${app.port}/`,
);
