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
  "Usage: bun run benchmark:browser-replay -- <manifest.json> <output-dir> <model.onnx> [port]";

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  portArgument = "4182",
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

const manifest = Schema.decodeUnknownSync(ManifestSchema)(
  JSON.parse(await readFile(manifestPath, "utf8")),
);

const benchmarkCase = manifest.cases.at(0);

if (benchmarkCase === undefined) {
  throw new Error("Replay manifest must contain at least one case.");
}

const modelFile = Bun.file(modelPath);

if (!(await modelFile.exists())) {
  throw new Error(
    `Production model does not exist at ${modelPath}.`,
  );
}

const port = Number.parseInt(portArgument, 10);

if (!Number.isInteger(port) || port < 1) {
  throw new Error(
    `Port must be a positive integer, received "${portArgument}".`,
  );
}

await mkdir(outputRoot, { recursive: true });

const build = await Bun.build({
  entrypoints: [
    join(import.meta.dir, "browser-replay-client.ts"),
  ],
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "inline",
});

if (!build.success) {
  throw new Error(
    `Could not build replay client.\n${build.logs
      .map((log) => log.message)
      .join("\n")}`,
  );
}

const clientOutput = build.outputs.at(0);

if (clientOutput === undefined) {
  throw new Error("Replay client produced no bundle.");
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

if (process.env.BGCUT_BROWSER_REPLAY_BUILD_ONLY === "1") {
  console.log("Browser replay bundle check passed.");

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
    <title>bgcut graph replay sentinel</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

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

    if (
      request.method === "GET" &&
      url.pathname === "/client.js"
    ) {
      return new Response(clientSource, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
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
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/input"
    ) {
      return new Response(
        Bun.file(
          resolve(manifestRoot, benchmarkCase.input),
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
          "content-type": "application/octet-stream",
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
      url.pathname.match(/^\/output\/(\d+)$/u);

    if (
      request.method === "POST" &&
      outputMatch !== null
    ) {
      const index = Number.parseInt(outputMatch[1], 10);

      const targetPath = join(
        outputRoot,
        `run-${index + 1}.png`,
      );

      await writeFile(
        targetPath,
        new Uint8Array(await request.arrayBuffer()),
      );

      const stats = await sharp(targetPath)
        .ensureAlpha()
        .stats();

      const alpha = stats.channels.at(3);

      if (alpha === undefined || alpha.max === 0) {
        return new Response(
          `Run ${index + 1} output is fully transparent.`,
          { status: 422 },
        );
      }

      return new Response("saved");
    }

    if (
      request.method === "POST" &&
      url.pathname === "/failure"
    ) {
      await writeFile(
        join(outputRoot, "browser-failure.json"),
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
        join(outputRoot, "browser-replay.json"),
        `${JSON.stringify(
          await request.json(),
          null,
          2,
        )}\n`,
      );

      return new Response("saved");
    }

    return new Response("Not found.", { status: 404 });
  },
});

console.log(
  `Browser replay sentinel ready at http://${app.hostname}:${app.port}/`,
);
