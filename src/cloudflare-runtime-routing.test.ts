import { describe, expect, test } from "bun:test";

const workerSource = await Bun.file(new URL("../worker/index.ts", import.meta.url)).text();
const wranglerConfig = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text();
const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json();

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
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts["cloudflare:runtime:local"]).toContain(
      "ort-wasm-simd-threaded.asyncify.wasm",
    );
    expect(scripts["cloudflare:runtime:local"]).toContain(
      "--content-type application/wasm",
    );
    expect(scripts["cloudflare:r2:local"]).toContain("cloudflare:model:local");
    expect(scripts["cloudflare:r2:local"]).toContain("cloudflare:runtime:local");
  });
});
