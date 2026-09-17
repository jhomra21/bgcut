import { describe, expect, test } from "bun:test";

const workerSource = await Bun.file(new URL("../worker/index.ts", import.meta.url)).text();

const wranglerConfig = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text();

const packageSource = await Bun.file(new URL("../package.json", import.meta.url)).text();

describe("Cloudflare WebGPU runtime routing", () => {
  test("routes model and runtime assets through the Worker before SPA fallback", () => {
    expect(wranglerConfig).toContain('"/models/*"');
    expect(wranglerConfig).toContain('"/runtime/*"');
  });

  test("serves the WebGPU runtime with the WebAssembly MIME type", () => {
    expect(workerSource).toContain("ORT_WEBGPU_WASM_FILENAME");
    expect(workerSource).toContain('"application/wasm"');
  });

  test("seeds the exact WebGPU asyncify runtime into local R2", () => {
    expect(packageSource).toContain('"cloudflare:runtime:local"');
    expect(packageSource).toContain("ort-wasm-simd-threaded.asyncify.wasm");
    expect(packageSource).toContain("--content-type application/wasm");
    expect(packageSource).toContain('"cloudflare:r2:local"');
    expect(packageSource).toContain("cloudflare:model:local");
  });
});
