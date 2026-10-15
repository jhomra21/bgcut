import { expect, test } from "bun:test";

import { selectVideoTimestamps } from "./video-timeline";

test("retains actual 60 fps motion and does not duplicate a 24 fps source", () => {
  const sixty = Array.from({ length: 60 }, (_, index) => 2 + index / 60);
  const twentyFour = Array.from({ length: 24 }, (_, index) => 2 + index / 24);

  expect(selectVideoTimestamps(sixty, 2, 3, 60)).toEqual(sixty);
  expect(selectVideoTimestamps(twentyFour, 2, 3, 60)).toEqual(twentyFour);
  expect(selectVideoTimestamps(sixty, 2, 3, 30)).toHaveLength(30);
});

test("preserves VFR timing, trim-relative start, sorted presentation order and end exclusion", () => {
  const timestamps = [4.4, 4, 4.1, 4.1, 4.9, 5.2];

  expect(selectVideoTimestamps(timestamps, 4.05, 5.2, 60)).toEqual([4.05, 4.1, 4.4, 4.9]);
});

test("bounds a 15-second 120 fps source to 900 real selected frames", () => {
  const frames = Array.from({ length: 1800 }, (_, index) => index / 120);
  const output = selectVideoTimestamps(frames, 0, 15, 60);

  expect(output).toHaveLength(900);
  expect(new Set(output).size).toBe(900);
  expect(output.every((timestamp) => frames.includes(timestamp))).toBe(true);
});
