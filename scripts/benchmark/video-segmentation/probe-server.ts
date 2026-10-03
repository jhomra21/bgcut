import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import {
  join,
  resolve,
} from "node:path";

import {
  ORT_WEBGPU_WASM_PUBLIC_PATH,
} from "../../../src/shared/ort-assets";

import {
  proxyVideoModelRequest,
} from "./model-proxy";

const outputArgument =
  process.argv[2];

const portArgument =
  process.argv[3] ??
  "4187";

if (outputArgument === undefined) {
  throw new Error(
    "Usage: bun run benchmark:video-segmentation:probe -- <output-dir> [port]",
  );
}

const outputRoot =
  resolve(outputArgument);

const port =
  Number.parseInt(
    portArgument,
    10,
  );

if (
  !Number.isInteger(port) ||
  port < 1
) {
  throw new Error(
    `Port must be a positive integer, received "${portArgument}".`,
  );
}

await mkdir(
  outputRoot,
  {
    recursive: true,
  },
);

const build =
  await Bun.build({
    entrypoints: [
      join(
        import.meta.dir,
        "probe-client.ts",
      ),
    ],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
  });

if (!build.success) {
  throw new Error(
    `Could not build video model probe.\n${build.logs
      .map(
        (log) =>
          log.message,
      )
      .join("\n")}`,
  );
}

const client =
  build.outputs.at(0);

if (client === undefined) {
  throw new Error(
    "Video model probe produced no client bundle.",
  );
}

const clientSource =
  await client.text();

const runtimePath =
  resolve(
    import.meta.dir,
    "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
  );

const runtime =
  Bun.file(
    runtimePath,
  );

if (!(await runtime.exists())) {
  throw new Error(
    `ONNX Runtime WebGPU runtime is missing at ${runtimePath}.`,
  );
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut video model probe</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script
      type="module"
      src="/client.js"
    ></script>
  </body>
</html>
`;

let reportIndex = 0;

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

      const modelResponse =
        await proxyVideoModelRequest(
          request,
        );

      if (
        modelResponse !==
        null
      ) {
        return modelResponse;
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

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/report"
      ) {
        const value =
          await request.json();

        reportIndex += 1;

        await writeFile(
          join(
            outputRoot,
            `probe-${reportIndex}.json`,
          ),
          `${JSON.stringify(
            value,
            null,
            2,
          )}\n`,
        );

        return new Response(
          "saved",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/complete"
      ) {
        await writeFile(
          join(
            outputRoot,
            "video-model-probe.json",
          ),
          `${JSON.stringify(
            await request.json(),
            null,
            2,
          )}\n`,
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
        await writeFile(
          join(
            outputRoot,
            "video-model-probe-failure.json",
          ),
          `${JSON.stringify(
            await request.json(),
            null,
            2,
          )}\n`,
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
  `Video model probe ready at http://${app.hostname}:${app.port}/`,
);
