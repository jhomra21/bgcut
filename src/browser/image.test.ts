import { describe, expect, test } from "bun:test";

import { isSupportedImageType } from "./image";

describe("isSupportedImageType", () => {
  test("accepts formats the browser pipeline supports", () => {
    expect(isSupportedImageType("image/png")).toBe(true);
    expect(isSupportedImageType("image/jpeg")).toBe(true);
    expect(isSupportedImageType("image/webp")).toBe(true);
    expect(isSupportedImageType("image/avif")).toBe(true);
  });

  test("rejects unsupported and missing mime types", () => {
    expect(isSupportedImageType("image/gif")).toBe(false);
    expect(isSupportedImageType("image/svg+xml")).toBe(false);
    expect(isSupportedImageType("")).toBe(false);
  });
});
