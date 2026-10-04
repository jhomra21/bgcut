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

const releaseModelUrl = new URL(MODEL_RELEASE_URL);

const releaseWebGpuModelUrl = new URL(WEBGPU_MODEL_RELEASE_URL);

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
        const proxied = await proxyVideoModelRequest(
          new Request(`http://127.0.0.1${requestUrl}`),
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
