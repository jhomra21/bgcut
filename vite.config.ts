import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

import {
  MODEL_PUBLIC_PATH,
  MODEL_RELEASE_URL,
} from "./src/engine/model-config.ts";

const releaseModelUrl = new URL(MODEL_RELEASE_URL);

export default defineConfig({
  plugins: [solid()],
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
});
