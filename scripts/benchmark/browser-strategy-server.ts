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

const ManifestCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const ManifestSchema = Schema.Struct({
  cases: Schema.Array(ManifestCaseSchema),
});

const usage =
  "Usage: bun run benchmark:browser-strategy -- <manifest.json> <output-dir> <model.onnx> [runs-per-strategy] [port]";

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

const modelPath = resolve(modelArgument);

const runsPerStrategy = Number.parseInt(
  runsArgument,
  10,
);

if (
  !Number.isInteger(runsPerStrategy) ||
  runsPerStrategy < 1
) {
  throw new Error(
    `Runs per strategy must be a positive integer, received "${runsArgument}".`,
  );
}

const port = Number.parseInt(portArgument, 10);

if (!Number.isInteger(port) || port < 1) {
  throw new Error(
    `Port must be a positive integer, received "${portArgument}".`,
  );
}

const manifest = Schema.decodeUnknownSync(ManifestSchema)(
  JSON.parse(
    await readFile(manifestPath, "utf8"),
  ),
);

const benchmarkCase = manifest.cases.at(0);

if (benchmarkCase === undefined) {
  throw new Error(
    "Strategy manifest must contain at least one case.",
  );
}

const modelFile = Bun.file(modelPath);

if (!(await modelFile.exists())) {
  throw new Error(
    `Production model does not exist at ${modelPath}.`,
  );
}

const strategies = [
  "no-capture-reuse",
  "capture-recreate",
] as const;

await Promise.all([
  mkdir(outputRoot, { recursive: true }),
  ...strategies.map((strategy) =>
    mkdir(
      join(outputRoot, strategy),
      { recursive: true },
    )
  ),
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
    `Could not build strategy client.\n${build.logs
      .map((log) => log.message)
      .join("\n")}`,
  );
}

const clientOutput = build.outputs.at(0);

if (clientOutput === undefined) {
  throw new Error(
    "Strategy client produced no bundle.",
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

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut Safari WebGPU strategy benchmark</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const compareOutputs = async (): Promise<unknown> => {
  const left = await sharp(
    join(
      outputRoot,
      "no-capture-reuse",
      "run-1.png",
    ),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const right = await sharp(
    join(
      outputRoot,
      "capture-recreate",
      "run-1.png",
    ),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (
    left.info.width !== right.info.width ||
    left.info.height !== right.info.height ||
    left.info.channels !== 4 ||
    right.info.channels !== 4
  ) {
    throw new Error(
      "Strategy output dimensions differ.",
    );
  }

  let absolute = 0;
  let maximum = 0;
  let differing = 0;

  for (
    let index = 0;
    index < left.data.length;
    index += 1
  ) {
    const difference = Math.abs(
      left.data[index] - right.data[index],
    );

    absolute += difference;
    maximum = Math.max(maximum, difference);

    if (difference !== 0) {
      differing += 1;
    }
  }

  return {
    schemaVersion: 1,
    values: left.data.length,
    meanAbsoluteByteDifference:
      absolute / left.data.length,
    maxAbsoluteByteDifference: maximum,
    differingValues: differing,
    differingValueFraction:
      differing / left.data.length,
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
      return Response.json({
        id: benchmarkCase.id,
        inputUrl: "/input",
        runsPerStrategy,
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/input"
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
            "cache-control": "no-store",
          },
        },
      );
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

    const outputMatch =
      url.pathname.match(
        /^\/output\/(no-capture-reuse|capture-recreate)\/(\d+)$/u,
      );

    if (
      request.method === "POST" &&
      outputMatch !== null
    ) {
      const strategy = outputMatch[1];
      const index = Number.parseInt(
        outputMatch[2],
        10,
      );
      const targetPath = join(
        outputRoot,
        strategy,
        `run-${index + 1}.png`,
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
          `${strategy} run ${index + 1} output is fully transparent.`,
          { status: 422 },
        );
      }

      return new Response("saved");
    }

    const runMatch =
      url.pathname.match(
        /^\/run\/(no-capture-reuse|capture-recreate)\/(\d+)$/u,
      );

    if (
      request.method === "POST" &&
      runMatch !== null
    ) {
      const strategy = runMatch[1];
      const index = Number.parseInt(
        runMatch[2],
        10,
      );

      await writeFile(
        join(
          outputRoot,
          strategy,
          `run-${index + 1}.json`,
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
      const report = await request.json();

      await writeFile(
        join(
          outputRoot,
          "browser-strategies.json",
        ),
        `${JSON.stringify(
          report,
          null,
          2,
        )}\n`,
      );

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

      return Response.json({
        report: join(
          outputRoot,
          "browser-strategies.json",
        ),
        comparison: join(
          outputRoot,
          "pixel-comparison.json",
        ),
      });
    }

    return new Response(
      "Not found.",
      { status: 404 },
    );
  },
});

console.log(
  `Browser strategy benchmark ready at http://${app.hostname}:${app.port}/`,
);
