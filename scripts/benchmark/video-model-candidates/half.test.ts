import { expect, test } from "bun:test";

import { channelsToHalfTokens, floatToHalf, halfToFloat } from "./half";

test("Float16 conversion preserves signed values and finite extremes", () => {
  const source = Float32Array.of(0, -0, 1, -2, 0.5, 65504, -65504);
  const half = floatToHalf(source);

  expect([...half]).toEqual([0, 0x8000, 0x3c00, 0xc000, 0x3800, 0x7bff, 0xfbff]);
  expect(Object.is(halfToFloat(half[1] ?? 0), -0)).toBe(true);
  expect([...half].map(halfToFloat)).toEqual([...source]);
});

test("Float16 conversion handles subnormal and invalid floats", () => {
  const source = Float32Array.of(2 ** -24, -2 ** -24, Number.POSITIVE_INFINITY, Number.NaN);
  const half = floatToHalf(source);

  expect(half[0]).toBe(0x0001);
  expect(half[1]).toBe(0x8001);
  expect(half[2]).toBe(0x7c00);
  expect(Number.isNaN(halfToFloat(half[3] ?? 0))).toBe(true);
});

test("channel-major half tensors transpose to token-major memory rows", () => {
  const source = Uint16Array.of(1, 2, 3, 4, 5, 6);

  expect([...channelsToHalfTokens(source, 2, 3)]).toEqual([1, 4, 2, 5, 3, 6]);
  expect(() => channelsToHalfTokens(source, 2, 4)).toThrow();
});
