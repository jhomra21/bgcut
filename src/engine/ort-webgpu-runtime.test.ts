import { describe, expect, test } from "bun:test";

import {
  ORT_WEBGPU_WASM_FILENAME,
  ORT_WEBGPU_WASM_PUBLIC_PATH,
  resolveOrtWebGpuWasmUrl,
} from "./ort-webgpu-runtime";

describe("ORT WebGPU runtime asset", () => {
  test("uses the asyncify binary required by the WebGPU bundle", () => {
    expect(ORT_WEBGPU_WASM_FILENAME).toBe("ort-wasm-simd-threaded.asyncify.wasm");
    expect(ORT_WEBGPU_WASM_PUBLIC_PATH).toBe(
      "/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
  });

  test("resolves the R2-backed route against the current origin", () => {
    expect(resolveOrtWebGpuWasmUrl("http://localhost:8787/path")).toBe(
      "http://localhost:8787/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
    expect(resolveOrtWebGpuWasmUrl("https://bgcut.dev/")).toBe(
      "https://bgcut.dev/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
  });
});
