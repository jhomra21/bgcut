import { expect, test } from "bun:test";

import { annotatedForeground, annotationInstances } from "./annotation-instances";

test("DAVIS foreground union includes every nonblack palette channel", () => {
  const rgba = Uint8ClampedArray.of(
    0, 0, 0, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 0, 0, 0,
  );

  expect([...annotatedForeground(rgba)]).toEqual([0, 1, 1, 1, 0]);
});

test("DAVIS instance masks and synthetic click positions remain separate", () => {
  const rgba = Uint8ClampedArray.of(
    255, 0, 0, 255,
    0, 255, 0, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 0, 255,
    0, 255, 0, 255,
  );

  const instances = annotationInstances(rgba, 3, 2, 1);

  expect(instances.map((instance) => instance.rgb)).toEqual([
    [0, 255, 0],
    [255, 0, 0],
  ]);
  expect(instances.map((instance) => instance.pixels)).toEqual([3, 2]);
  const green = instances[0];
  const red = instances[1];

  if (green === undefined || red === undefined) {
    throw new Error("Two annotation instances were expected.");
  }

  expect([...green.mask]).toEqual([0, 1, 0, 1, 0, 1]);
  expect([...red.mask]).toEqual([1, 0, 1, 0, 0, 0]);

  for (const instance of instances) {
    const x = Math.floor(instance.seed.x * 3);
    const y = Math.floor(instance.seed.y * 2);

    expect(instance.mask[y * 3 + x]).toBe(1);
  }
});

test("DAVIS instance parsing rejects invalid or inconsistent geometry", () => {
  const pixels = Uint8ClampedArray.of(0, 0, 0, 255);

  expect(() => annotationInstances(pixels, 2, 2)).toThrow();
  expect(() => annotationInstances(pixels, 1, 1, 0)).toThrow();
  expect(() => annotatedForeground(Uint8ClampedArray.of(0, 1, 0))).toThrow();
});
