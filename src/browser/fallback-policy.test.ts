import { describe, expect, test } from "bun:test";

import {
  AdapterUnavailable,
  DeviceRequestFailed,
  ExportFailed,
  ImageDecodeFailed,
  ImageProcessingFailed,
  InferenceFailed,
  ModelDownloadFailed,
  ModelLoadFailed,
  RuntimeInitializationFailed,
  UnsupportedImage,
  WebGpuUnavailable,
} from "./errors";
import { shouldFallbackToWasm } from "./fallback-policy";

describe("WASM fallback policy", () => {
  test("falls back for WebGPU execution failures", () => {
    expect(shouldFallbackToWasm(new WebGpuUnavailable({ message: "missing" }))).toBe(true);
    expect(shouldFallbackToWasm(new AdapterUnavailable({ message: "missing" }))).toBe(true);
    expect(shouldFallbackToWasm(new DeviceRequestFailed({ message: "failed" }))).toBe(true);
    expect(shouldFallbackToWasm(new RuntimeInitializationFailed({ message: "failed" }))).toBe(true);
    expect(shouldFallbackToWasm(new ModelLoadFailed({ message: "failed" }))).toBe(true);
    expect(shouldFallbackToWasm(new InferenceFailed({ message: "failed" }))).toBe(true);
  });

  test("does not retry failures unrelated to WebGPU execution", () => {
    expect(shouldFallbackToWasm(new UnsupportedImage({ mimeType: "image/svg+xml" }))).toBe(false);
    expect(shouldFallbackToWasm(new ImageDecodeFailed({ fileName: "broken.png" }))).toBe(false);
    expect(shouldFallbackToWasm(new ImageProcessingFailed({ message: "failed" }))).toBe(false);
    expect(shouldFallbackToWasm(new ModelDownloadFailed({ message: "offline" }))).toBe(false);
    expect(shouldFallbackToWasm(new ExportFailed({ message: "failed" }))).toBe(false);
  });
});
