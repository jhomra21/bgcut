import { describe, expect, test } from "bun:test";

import { normalizeRgbaToNchw } from "./preprocess";

describe("normalizeRgbaToNchw", () => {
  test("writes normalized RGB channels in NCHW order", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 127, 255,
      0, 255, 255, 255,
    ]);

    const tensor = normalizeRgbaToNchw(pixels, 2, 1);

    expect(tensor.length).toBe(6);
    expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(tensor[1]).toBeCloseTo((0 - 0.485) / 0.229, 5);
    expect(tensor[2]).toBeCloseTo((0 - 0.456) / 0.224, 5);
    expect(tensor[3]).toBeCloseTo((1 - 0.456) / 0.224, 5);
    expect(tensor[4]).toBeCloseTo((127 / 255 - 0.406) / 0.225, 5);
    expect(tensor[5]).toBeCloseTo((1 - 0.406) / 0.225, 5);
  });
});
