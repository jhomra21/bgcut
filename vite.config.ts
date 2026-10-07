import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import solid from "@solidjs/vite-plugin";
import { defineConfig, type Plugin } from "vite";

import {
  proxyVideoModelRequest,
} from "./scripts/benchmark/video-segmentation/model-proxy.ts";

import {
  MODEL_PUBLIC_PATH,
  MODEL_RELEASE_URL,
  WEBGPU_MODEL_PUBLIC_PATH,
  WEBGPU_MODEL_RELEASE_URL,
} from "./src/shared/model-config.ts";
import {
  TRACKED_MASK_DECODER_CACHE_PATH,
  TRACKED_MASK_DECODER_PUBLIC_PATH,
} from "./src/shared/video-experimental-config.ts";
import {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WASM_MODULE_PUBLIC_PATH,
  ORT_WASM_PUBLIC_PATH,
  ORT_WEBGPU_WASM_FILENAME,
  ORT_WEBGPU_WASM_PUBLIC_PATH,
} from "./src/shared/ort-assets.ts";

const releaseModelUrl = new URL(MODEL_RELEASE_URL);

const releaseWebGpuModelUrl = new URL(WEBGPU_MODEL_RELEASE_URL);

const ORT_RUNTIME_ASSETS = [
  {
    publicPath: ORT_WEBGPU_WASM_PUBLIC_PATH,
    filename: ORT_WEBGPU_WASM_FILENAME,
    contentType: "application/wasm",
  },
  {
    publicPath: ORT_WASM_PUBLIC_PATH,
    filename: ORT_WASM_FILENAME,
    contentType: "application/wasm",
  },
  {
    publicPath: ORT_WASM_MODULE_PUBLIC_PATH,
    filename: ORT_WASM_MODULE_FILENAME,
    contentType: "text/javascript; charset=utf-8",
  },
] as const;

const ortRuntimeDirectory = resolve(
  "node_modules/onnxruntime-web/dist",
);

const ortRuntimeDevPlugin = (): Plugin => ({
  name: "bgcut-ort-runtime-dev",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const requestUrl = request.url;

      if (
        requestUrl === undefined ||
        (request.method !== "GET" &&
          request.method !== "HEAD")
      ) {
        next();

        return;
      }

      const pathname =
        new URL(
          requestUrl,
          "http://127.0.0.1",
        ).pathname;

      const asset =
        ORT_RUNTIME_ASSETS.find(
          (candidate) =>
            candidate.publicPath ===
            pathname,
        );

      if (asset === undefined) {
        next();

        return;
      }

      void (async () => {
        const bytes =
          await readFile(
            resolve(
              ortRuntimeDirectory,
              asset.filename,
            ),
          );

        response.statusCode = 200;
        response.setHeader(
          "content-type",
          asset.contentType,
        );
        response.setHeader(
          "cache-control",
          "no-store",
        );
        response.setHeader(
          "content-length",
          bytes.byteLength,
        );

        response.end(
          request.method === "HEAD"
            ? undefined
            : bytes,
        );
      })().catch((error) => {
        response.statusCode = 500;
        response.end(
          error instanceof Error
            ? error.message
            : String(error),
        );
      });
    });
  },
});

const videoModelDevPlugin = (): Plugin => ({
  name: "bgcut-video-model-dev-proxy",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const requestUrl = request.url;

      if (
        requestUrl === undefined ||
        !requestUrl.startsWith("/video-model/")
      ) {
        next();

        return;
      }

      void (async () => {
        const pathname =
          new URL(
            requestUrl,
            "http://127.0.0.1",
          ).pathname;

        if (
          pathname ===
          TRACKED_MASK_DECODER_PUBLIC_PATH
        ) {
          const bytes =
            await readFile(
              resolve(
                TRACKED_MASK_DECODER_CACHE_PATH,
              ),
            ).catch(
              () =>
                undefined,
            );

          if (
            bytes ===
            undefined
          ) {
            response.statusCode =
              404;
            response.end(
              "Tracked SAM decoder is not prepared. Run bun run video:model:prepare.",
            );

            return;
          }

          response.statusCode =
            200;

          response.setHeader(
            "content-type",
            "application/octet-stream",
          );

          response.setHeader(
            "cache-control",
            "no-store",
          );

          response.setHeader(
            "content-length",
            bytes.byteLength,
          );

          response.end(
            request.method ===
              "HEAD"
              ? undefined
              : bytes,
          );

          return;
        }

        const proxied =
          await proxyVideoModelRequest(
            new Request(
              `http://127.0.0.1${requestUrl}`,
            ),
          );

        if (proxied === null) {
          next();

          return;
        }

        response.statusCode = proxied.status;

        proxied.headers.forEach((value, key) => {
          response.setHeader(key, value);
        });

        response.end(
          new Uint8Array(
            await proxied.arrayBuffer(),
          ),
        );
      })().catch((error) => {
        response.statusCode = 502;
        response.end(
          error instanceof Error
            ? error.message
            : String(error),
        );
      });
    });
  },
});

export default defineConfig(({ mode }) => {
  const externalAssetHost = mode === "cloudflare" || mode === "package";

  return {
    plugins: [
      solid({ ssr: true }),
      ortRuntimeDevPlugin(),
      videoModelDevPlugin(),
    ],
    publicDir: externalAssetHost ? false : "public",
    build: mode === "package"
      ? {
          outDir: "dist/web",
          emptyOutDir: true,
        }
      : undefined,
    server: {
      proxy: {
        [MODEL_PUBLIC_PATH]: {
          target: releaseModelUrl.origin,
          changeOrigin: true,
          followRedirects: true,
          rewrite: () => releaseModelUrl.pathname,
        },
        [WEBGPU_MODEL_PUBLIC_PATH]: {
          target: releaseWebGpuModelUrl.origin,
          changeOrigin: true,
          followRedirects: true,
          rewrite: () => releaseWebGpuModelUrl.pathname,
        },
      },
    },
  };
});
