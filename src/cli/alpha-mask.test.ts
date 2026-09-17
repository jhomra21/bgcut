import { describe, expect, test } from "bun:test";

import { compositeAlphaMask } from "./alpha-mask";

describe("compositeAlphaMask", () => {
  test("reads one matte sample per pixel from interleaved raw channels", () => {
    const rgba = new Uint8Array([
      10, 20, 30, 255,
      40, 50, 60, 128,
      70, 80, 90, 64,
    ]);
    const mask = new Uint8Array([
      255, 4, 9,
      128, 5, 10,
      0, 6, 11,
    ]);

    compositeAlphaMask(rgba, mask, 3);

    expect(Array.from(rgba)).toEqual([
      10, 20, 30, 255,
      40, 50, 60, 64,
      70, 80, 90, 0,
    ]);
  });

  test("supports a true single-channel matte", () => {
    const rgba = new Uint8Array([
      1, 2, 3, 200,
      4, 5, 6, 100,
    ]);
    const mask = new Uint8Array([128, 255]);

    compositeAlphaMask(rgba, mask, 1);

    expect(rgba[3]).toBe(100);
    expect(rgba[7]).toBe(100);
  });

  test("rejects truncated interleaved matte data", () => {
    const rgba = new Uint8Array(8);
    const mask = new Uint8Array(5);

    expect(() => compositeAlphaMask(rgba, mask, 3)).toThrow("expected at least 6");
  });
});
