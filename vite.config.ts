import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

const benchmarkModelPath = "/__benchmark-model/birefnet-lite-512-ort-basic-webgpu.onnx";

const releaseModelPath =
  "/jhomra21/removebg-webgpu/releases/download/model-birefnet-lite-512-ort-basic-webgpu-v1/birefnet-lite-512-ort-basic-webgpu.onnx";

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      [benchmarkModelPath]: {
        target: "https://github.com",
        changeOrigin: true,
        followRedirects: true,
        rewrite: () => releaseModelPath,
      },
    },
  },
});
