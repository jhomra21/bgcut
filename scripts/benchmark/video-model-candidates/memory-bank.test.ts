import { expect, test } from "bun:test";

import { BoundedFrameMemory } from "./memory-bank";

test("tracking memory evicts oldest frames while preserving ascending indices", () => {
  const memory = new BoundedFrameMemory<{ readonly index: number; readonly name: string }>(3);

  for (let index = 0; index < 8; index += 1) {
    memory.push({ index, name: `frame-${index}` });
  }

  expect(memory.size).toBe(3);
  expect(memory.values().map((frame) => frame.index)).toEqual([5, 6, 7]);
});

test("independent subject memories do not share frames or rewind state", () => {
  const first = new BoundedFrameMemory<{ readonly index: number }>(2);
  const second = new BoundedFrameMemory<{ readonly index: number }>(2);

  first.push({ index: 0 });
  second.push({ index: 3 });
  first.push({ index: 1 });
  second.push({ index: 4 });

  expect(first.values().map((frame) => frame.index)).toEqual([0, 1]);
  expect(second.values().map((frame) => frame.index)).toEqual([3, 4]);

  first.clear();
  first.push({ index: 0 });

  expect(first.values().map((frame) => frame.index)).toEqual([0]);
  expect(second.values().map((frame) => frame.index)).toEqual([3, 4]);
});

test("tracking memory rejects stale indices and invalid capacities", () => {
  expect(() => new BoundedFrameMemory(0)).toThrow();
  expect(() => new BoundedFrameMemory(1.5)).toThrow();

  const memory = new BoundedFrameMemory<{ readonly index: number }>(3);

  memory.push({ index: 3 });

  expect(() => memory.push({ index: 3 })).toThrow();
  expect(() => memory.push({ index: 2 })).toThrow();
  expect(() => memory.push({ index: Number.NaN })).toThrow();
  expect(memory.values().map((frame) => frame.index)).toEqual([3]);
});

test("snapshot mutation cannot change internal tracking memory", () => {
  const memory = new BoundedFrameMemory<{ readonly index: number }>(2);

  memory.push({ index: 0 });

  const snapshot = memory.values();

  // The API intentionally exposes a readonly type. Exercise the returned
  // array's runtime mutability without weakening the public type contract.
  Reflect.apply(Array.prototype.pop, snapshot, []);

  expect(memory.size).toBe(1);
  expect(memory.values().map((frame) => frame.index)).toEqual([0]);
});
