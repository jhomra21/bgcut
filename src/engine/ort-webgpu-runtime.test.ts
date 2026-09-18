import { describe, expect, test } from "bun:test";

import {
  ORT_WASM_FILENAME,
  ORT_WASM_PUBLIC_PATH,
  ORT_WEBGPU_WASM_FILENAME,
  ORT_WEBGPU_WASM_PUBLIC_PATH,
  resolveOrtWasmUrl,
  resolveOrtWebGpuWasmUrl,
} from "./ort-webgpu-runtime";

describe("ORT runtime assets", () => {
  test("uses the exact WebGPU and fallback binaries", () => {
    expect(ORT_WEBGPU_WASM_FILENAME).toBe("ort-wasm-simd-threaded.asyncify.wasm");
    expect(ORT_WEBGPU_WASM_PUBLIC_PATH).toBe(
      "/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
    expect(ORT_WASM_FILENAME).toBe("ort-wasm-simd-threaded.wasm");
    expect(ORT_WASM_PUBLIC_PATH).toBe(
      "/runtime/ort-wasm-simd-threaded.wasm",
    );
  });

  test("resolves both R2-backed routes against the current origin", () => {
    expect(resolveOrtWebGpuWasmUrl("http://localhost:8787/path")).toBe(
      "http://localhost:8787/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
    expect(resolveOrtWasmUrl("http://localhost:8787/path")).toBe(
      "http://localhost:8787/runtime/ort-wasm-simd-threaded.wasm",
    );
    expect(resolveOrtWebGpuWasmUrl("https://bgcut.dev/")).toBe(
      "https://bgcut.dev/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
    expect(resolveOrtWasmUrl("https://bgcut.dev/")).toBe(
      "https://bgcut.dev/runtime/ort-wasm-simd-threaded.wasm",
    );
  });
});
