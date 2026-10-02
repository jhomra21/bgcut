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

const MEDIABUNNY_REVISION =
  "1dd3971ffaf3f95b30b1ca9205fc8378df699352";

const FIXTURE_URL =
  `https://raw.githubusercontent.com/Vanilagy/mediabunny/${MEDIABUNNY_REVISION}/test/public/rotate-buck-bunny.mp4`;

const FIXTURE_BYTES =
  675_899;

const outputArgument =
  process.argv[2];

const portArgument =
  process.argv[3] ??
  "4189";

if (
  outputArgument ===
  undefined
) {
  throw new Error(
    "Usage: bun run benchmark:video-segmentation:temporal-smoke -- <output-dir> [port]",
  );
}

const outputRoot =
  resolve(
    outputArgument,
  );

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

await mkdir(
  outputRoot,
  {
    recursive: true,
  },
);

const fixtureResponse =
  await fetch(
    FIXTURE_URL,
  );

if (
  !fixtureResponse.ok
) {
  throw new Error(
    `Could not fetch MediaBunny temporal fixture: HTTP ${fixtureResponse.status}.`,
  );
}

const fixture =
  new Uint8Array(
    await fixtureResponse.arrayBuffer(),
  );

if (
  fixture.byteLength !==
  FIXTURE_BYTES
) {
  throw new Error(
    `MediaBunny temporal fixture was ${fixture.byteLength} bytes instead of ${FIXTURE_BYTES}.`,
  );
}

const build =
  await Bun.build({
    entrypoints: [
      join(
        import.meta.dir,
        "temporal-smoke-client.ts",
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
    `Could not build video temporal smoke.\n${build.logs
      .map(
        (log) =>
          log.message,
      )
      .join("\n")}`,
  );
}

const client =
  build.outputs.at(0);

if (
  client === undefined
) {
  throw new Error(
    "Video temporal smoke produced no client bundle.",
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

if (
  !(await runtime.exists())
) {
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
    <title>bgcut video temporal smoke</title>
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

const safeCandidate = (
  raw: unknown,
): string =>
  typeof raw ===
    "string"
    ? raw.replace(
        /[^a-z0-9-]/giu,
        "_",
      )
    : "unknown";

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
          "/fixture.mp4"
      ) {
        return new Response(
          fixture,
          {
            headers: {
              "content-type":
                "video/mp4",
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
        (
          url.pathname ===
            "/result" ||
          url.pathname ===
            "/failure"
        )
      ) {
        const value =
          await request.json();

        const candidate =
          safeCandidate(
            (
              value as {
                candidate?:
                  unknown;
              }
            ).candidate,
          );

        const kind =
          url.pathname ===
            "/result"
            ? "result"
            : "failure";

        await writeFile(
          join(
            outputRoot,
            `${candidate}-${kind}.json`,
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

      return new Response(
        "Not found.",
        {
          status: 404,
        },
      );
    },
  });

console.log(
  `Video temporal smoke ready at http://${app.hostname}:${app.port}/`,
);
