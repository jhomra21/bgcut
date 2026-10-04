import {
  join,
  resolve,
} from "node:path";

import {
  ORT_WEBGPU_WASM_PUBLIC_PATH,
} from "../../../src/shared/ort-assets";

import {
  proxyBiRefNetSeedModelRequest,
} from "./birefnet-model-proxy";
import {
  proxyVideoModelRequest,
} from "./model-proxy";

const port =
  Number.parseInt(
    process.argv[2] ??
      "4192",
    10,
  );

if (
  !Number.isInteger(
    port,
  ) ||
  port < 1
) {
  throw new Error(
    "Video demo port must be a positive integer.",
  );
}

const build =
  await Bun.build({
    entrypoints: [
      join(
        import.meta.dir,
        "demo-client.ts",
      ),
    ],
    target:
      "browser",
    format:
      "esm",
    minify:
      false,
    sourcemap:
      "inline",
  });

if (
  !build.success
) {
  throw new Error(
    `Could not build the video demo.\n${build.logs
      .map(
        (log) =>
          log.message,
      )
      .join(
        "\n",
      )}`,
  );
}

const output =
  build.outputs[0];

if (
  output ===
  undefined
) {
  throw new Error(
    "Video demo produced no client bundle.",
  );
}

const client =
  await output.text();

const runtime =
  Bun.file(
    resolve(
      import.meta.dir,
      "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
    ),
  );

if (
  !(await runtime.exists())
) {
  throw new Error(
    "ONNX Runtime WebGPU runtime is missing.",
  );
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1"
    />
    <title>bgcut local video demo</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: #111;
        color: #f4f4f4;
      }

      body {
        margin: 0;
        padding: 32px;
      }

      main {
        max-width: 1180px;
        margin: 0 auto;
      }

      h1 {
        font-size: 20px;
        margin: 0 0 8px;
      }

      p {
        color: #aaa;
        line-height: 1.5;
      }

      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        margin: 24px 0;
      }

      button,
      input {
        font: inherit;
      }

      button {
        padding: 8px 12px;
      }

      pre {
        white-space: pre-wrap;
        min-height: 42px;
        color: #bbb;
      }

      .panes {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }

      .pane {
        min-width: 0;
      }

      .pane h2 {
        font-size: 13px;
        font-weight: 500;
        color: #999;
      }

      .canvas-shell {
        width: 100%;
        overflow: hidden;
        border-radius: 8px;
        background-color: #b8b8b8;
        background-image:
          linear-gradient(45deg, #909090 25%, transparent 25%),
          linear-gradient(-45deg, #909090 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #909090 75%),
          linear-gradient(-45deg, transparent 75%, #909090 75%);
        background-size: 24px 24px;
        background-position: 0 0, 0 12px, 12px -12px, -12px 0;
      }

      canvas {
        display: block;
        width: 100%;
        height: auto;
      }

      @media (max-width: 760px) {
        body {
          padding: 18px;
        }

        .panes {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>bgcut local video research demo</h1>
      <p>
        Choose a local video. The first six seconds are decoded with MediaBunny,
        segmented locally with fp16 BiRefNet + EdgeTAM, and replayed below.
        Nothing is uploaded.
      </p>

      <div class="controls">
        <input
          id="video-file"
          type="file"
          accept="video/*"
        />
        <button id="run">
          Process preview
        </button>
        <button
          id="replay"
          disabled
        >
          Replay
        </button>
      </div>

      <pre id="status">Choose a video to begin.</pre>

      <div class="panes">
        <section class="pane">
          <h2>Source</h2>
          <div class="canvas-shell">
            <canvas id="source"></canvas>
          </div>
        </section>

        <section class="pane">
          <h2>Cutout</h2>
          <div class="canvas-shell">
            <canvas id="cutout"></canvas>
          </div>
        </section>
      </div>

      <script
        type="module"
        src="/client.js"
      ></script>
    </main>
  </body>
</html>`;

const app =
  Bun.serve({
    hostname:
      "127.0.0.1",
    port,

    async fetch(
      request,
    ) {
      const url =
        new URL(
          request.url,
        );

      const biRefNet =
        await proxyBiRefNetSeedModelRequest(
          request,
        );

      if (
        biRefNet !==
        null
      ) {
        return biRefNet;
      }

      const videoModel =
        await proxyVideoModelRequest(
          request,
        );

      if (
        videoModel !==
        null
      ) {
        return videoModel;
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/"
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
          client,
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
          ORT_WEBGPU_WASM_PUBLIC_PATH
      ) {
        return new Response(
          runtime,
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

      return new Response(
        "Not found.",
        {
          status: 404,
        },
      );
    },
  });

console.log(
  `bgcut local video demo: http://${app.hostname}:${app.port}/`,
);
