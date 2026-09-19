import { describe, expect, test } from "bun:test";

import {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WASM_MODULE_PUBLIC_PATH,
  ORT_WASM_PUBLIC_PATH,
  ORT_WEBGPU_WASM_FILENAME,
  ORT_WEBGPU_WASM_PUBLIC_PATH,
  resolveOrtWasmModuleUrl,
  resolveOrtWasmUrl,
  resolveOrtWebGpuWasmUrl,
} from "./runtime-assets";

describe("ORT runtime assets", () => {
  test("uses the exact WebGPU, fallback, and module runtime files", () => {
    expect(ORT_WEBGPU_WASM_FILENAME).toBe("ort-wasm-simd-threaded.asyncify.wasm");
    expect(ORT_WEBGPU_WASM_PUBLIC_PATH).toBe(
      "/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
    expect(ORT_WASM_FILENAME).toBe("ort-wasm-simd-threaded.wasm");
    expect(ORT_WASM_PUBLIC_PATH).toBe("/runtime/ort-wasm-simd-threaded.wasm");
    expect(ORT_WASM_MODULE_FILENAME).toBe("ort-wasm-simd-threaded.mjs");
    expect(ORT_WASM_MODULE_PUBLIC_PATH).toBe("/runtime/ort-wasm-simd-threaded.mjs");
  });

  test("resolves all R2-backed routes against the current origin", () => {
    expect(resolveOrtWebGpuWasmUrl("http://localhost:8787/path")).toBe(
      "http://localhost:8787/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
    expect(resolveOrtWasmUrl("http://localhost:8787/path")).toBe(
      "http://localhost:8787/runtime/ort-wasm-simd-threaded.wasm",
    );
    expect(resolveOrtWasmModuleUrl("http://localhost:8787/path")).toBe(
      "http://localhost:8787/runtime/ort-wasm-simd-threaded.mjs",
    );
    expect(resolveOrtWebGpuWasmUrl("https://bgcut.dev/")).toBe(
      "https://bgcut.dev/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    );
    expect(resolveOrtWasmUrl("https://bgcut.dev/")).toBe(
      "https://bgcut.dev/runtime/ort-wasm-simd-threaded.wasm",
    );
    expect(resolveOrtWasmModuleUrl("https://bgcut.dev/")).toBe(
      "https://bgcut.dev/runtime/ort-wasm-simd-threaded.mjs",
    );
  });
});
