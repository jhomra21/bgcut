import { describe, expect, test } from "bun:test";

import { planVideoExport } from "./video-export";

const source = { width: 1920, height: 1080, duration: 45, firstTimestamp: 2 };

describe("experimental video export contract", () => {
  test("selects a later trim with source timestamps and relative output timing", () => {
    const plan = planVideoExport(source, { start: 20, end: 22.1 });

    expect(plan.maxFps).toBe(60);
    expect(plan.duration).toBeCloseTo(2.1);
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.quality).toBe("high");
    expect(plan.mime).toBe("video/webm");
    expect(plan.alpha).toBe("keep");
  });

  test("preserves original dimensions and makes MP4 opacity explicit", () => {
    const plan = planVideoExport(source, {
      start: 0, end: 1, size: "original", format: "mp4", background: "black",
    });

    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.codec).toBe("avc");
    expect(plan.alpha).toBe("discard");
    expect(plan.background).toBe("black");
    expect(plan.mime).toBe("video/mp4");
  });

  test("does not silently truncate invalid or over-budget ranges", () => {
    for (const range of [
      { start: -1, end: 1 },
      { start: 5, end: 4 },
      { start: 40, end: 46 },
      { start: 0, end: 16 },
      { start: Number.NaN, end: 1 },
    ]) {
      expect(() => planVideoExport(source, range)).toThrow();
    }
  });

  test("preserves portrait aspect ratio without upscaling", () => {
    const plan = planVideoExport(
      { ...source, width: 480, height: 854 },
      { start: 0, end: 1, size: 720 },
    );

    expect(plan.width).toBe(405);
    expect(plan.height).toBe(720);
  });
});
