import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

import {
  MODEL_PUBLIC_PATH,
  MODEL_RELEASE_URL,
} from "./src/core/model-config.ts";

const releaseModelUrl = new URL(MODEL_RELEASE_URL);

export default defineConfig(({ mode }) => {
  const externalAssetHost = mode === "cloudflare" || mode === "package";

  return {
    plugins: [solid()],
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
      },
    },
  };
});
