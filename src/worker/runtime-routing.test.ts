import { describe, expect, test } from "bun:test";

const workerSource = await Bun.file(new URL("./index.ts", import.meta.url)).text();

const wranglerConfig = await Bun.file(new URL("../../wrangler.jsonc", import.meta.url)).text();

const packageSource = await Bun.file(new URL("../../package.json", import.meta.url)).text();

const cloudflareBuildSource = await Bun.file(
  new URL("../../scripts/cloudflare/prepare-dist.ts", import.meta.url),
).text();

const staticHeadersSource = await Bun.file(
  new URL("../../public/_headers", import.meta.url),
).text();

describe("Cloudflare runtime routing", () => {
  test("routes model and runtime assets through the Worker before SPA fallback", () => {
    expect(wranglerConfig).toContain('"/models/*"');
    expect(wranglerConfig).toContain('"/runtime/*"');
  });

  test("serves both WASM binaries and the module loader from R2", () => {
    expect(workerSource).toContain("ORT_WEBGPU_WASM_FILENAME");
    expect(workerSource).toContain("ORT_WASM_FILENAME");
    expect(workerSource).toContain("ORT_WASM_MODULE_FILENAME");
    expect(workerSource).toContain('"application/wasm"');
    expect(workerSource).toContain('"text/javascript; charset=utf-8"');
  });

  test("seeds all pinned ONNX Runtime files into local R2", () => {
    expect(packageSource).toContain('"cloudflare:runtime:local"');
    expect(packageSource).toContain("ort-wasm-simd-threaded.asyncify.wasm");
    expect(packageSource).toContain("ort-wasm-simd-threaded.wasm");
    expect(packageSource).toContain("ort-wasm-simd-threaded.mjs");
    expect(packageSource).toContain("--content-type application/wasm");
    expect(packageSource).toContain("--content-type text/javascript");
    expect(packageSource).toContain('"cloudflare:r2:local"');
    expect(packageSource).toContain("cloudflare:model:local");
  });

  test("ships static search metadata and discovery files through Cloudflare assets", () => {
    expect(packageSource).toContain('"site:prepare-routes"');
    expect(cloudflareBuildSource).toContain('"llms.txt"');
    expect(cloudflareBuildSource).toContain('"docs.html"');
    expect(cloudflareBuildSource).toContain('"changelog.html"');
  });

  test("hardens static responses and caches fingerprinted assets", () => {
    expect(cloudflareBuildSource).toContain('"_headers"');
    expect(staticHeadersSource).toContain("Content-Security-Policy:");
    expect(staticHeadersSource).toContain("X-Frame-Options: DENY");
    expect(staticHeadersSource).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(staticHeadersSource).toContain("Strict-Transport-Security: max-age=31536000");
    expect(staticHeadersSource).toContain("/assets/*");
    expect(staticHeadersSource).toContain("max-age=31536000, immutable");
  });

  test("keeps discrete ONNX Runtime assets out of Workers Static Assets", () => {
    expect(cloudflareBuildSource).toContain("isOrtRuntimeAsset");
    expect(cloudflareBuildSource).toContain(
      "Cloudflare builds must serve ONNX Runtime assets from R2",
    );
  });
});
