import { describe, expect, test } from "bun:test";

const workerSource = await Bun.file(new URL("../worker/index.ts", import.meta.url)).text();

const wranglerConfig = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text();

const packageSource = await Bun.file(new URL("../package.json", import.meta.url)).text();

const cloudflareBuildSource = await Bun.file(
  new URL("../scripts/prepare-cloudflare-dist.ts", import.meta.url),
).text();

describe("Cloudflare runtime routing", () => {
  test("routes model and runtime assets through the Worker before SPA fallback", () => {
    expect(wranglerConfig).toContain('"/models/*"');
    expect(wranglerConfig).toContain('"/runtime/*"');
  });

  test("serves both ONNX Runtime binaries with the WebAssembly MIME type", () => {
    expect(workerSource).toContain("ORT_WEBGPU_WASM_FILENAME");
    expect(workerSource).toContain("ORT_WASM_FILENAME");
    expect(workerSource).toContain('"application/wasm"');
  });

  test("seeds both pinned ONNX Runtime binaries into local R2", () => {
    expect(packageSource).toContain('"cloudflare:runtime:local"');
    expect(packageSource).toContain("ort-wasm-simd-threaded.asyncify.wasm");
    expect(packageSource).toContain("ort-wasm-simd-threaded.wasm");
    expect(packageSource).toContain("--content-type application/wasm");
    expect(packageSource).toContain('"cloudflare:r2:local"');
    expect(packageSource).toContain("cloudflare:model:local");
  });

  test("keeps ONNX Runtime wasm binaries out of Workers Static Assets", () => {
    expect(cloudflareBuildSource).toContain("isOrtWasmBinary");
    expect(cloudflareBuildSource).toContain(
      "Cloudflare builds must serve ONNX Runtime WASM binaries from R2",
    );
  });
});
