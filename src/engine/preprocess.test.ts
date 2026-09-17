import { describe, expect, test } from "bun:test";

import { normalizeRgbaToNchw, resizeRgbaLinearToNchw } from "./preprocess";

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

describe("resizeRgbaLinearToNchw", () => {
  test("matches normalized input when source and target sizes are equal", () => {
    const pixels = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);

    const expected = normalizeRgbaToNchw(pixels, 2, 2);
    const actual = resizeRgbaLinearToNchw(pixels, 2, 2, 2, 2);

    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  test("samples pixel centers with bilinear filtering before normalization", () => {
    const pixels = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);

    const tensor = resizeRgbaLinearToNchw(pixels, 2, 2, 1, 1);
    const average = 0.5;

    expect(tensor.length).toBe(3);
    expect(tensor[0]).toBeCloseTo((average - 0.485) / 0.229, 5);
    expect(tensor[1]).toBeCloseTo((average - 0.456) / 0.224, 5);
    expect(tensor[2]).toBeCloseTo((average - 0.406) / 0.225, 5);
  });

  test("clamps samples at texture edges like the default WebGPU sampler", () => {
    const pixels = new Uint8Array([64, 128, 192, 255]);
    const tensor = resizeRgbaLinearToNchw(pixels, 1, 1, 3, 2);
    const pixelCount = 6;

    for (let index = 0; index < pixelCount; index += 1) {
      expect(tensor[index]).toBeCloseTo((64 / 255 - 0.485) / 0.229, 5);
      expect(tensor[pixelCount + index]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 5);
      expect(tensor[pixelCount * 2 + index]).toBeCloseTo((192 / 255 - 0.406) / 0.225, 5);
    }
  });
});