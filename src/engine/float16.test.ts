import { describe, expect, test } from "bun:test";

import { fp16BitsToFloat32Array } from "./float16";

describe("fp16 conversion", () => {
  test("converts representative binary16 values to float32", () => {
    const values = fp16BitsToFloat32Array(
      new Uint16Array([
        0x0000,
        0x3c00,
        0xc000,
        0x3800,
        0x7c00,
      ]),
    );

    expect(Array.from(values.slice(0, 4))).toEqual([0, 1, -2, 0.5]);
    expect(values[4]).toBe(Number.POSITIVE_INFINITY);
  });
});
