import { describe, expect, test } from "bun:test";

import { createRemovalTimingRecorder } from "./timing";

describe("createRemovalTimingRecorder", () => {
  test("records stage durations, total wall time, and warm-session reuse", () => {
    let current = 100;
    const recorder = createRemovalTimingRecorder(() => current);

    const stopDecode = recorder.begin("decodeMs");
    current = 112.3456;
    stopDecode();

    const stopInference = recorder.begin("inferenceMs");
    current = 140;
    stopInference();

    const stopReadback = recorder.begin("outputReadbackMs");
    current = 147.7777;
    stopReadback();

    recorder.markSessionReused();
    current = 155.4321;

    expect(recorder.finish()).toEqual({
      decodeMs: 12.346,
      runtimeMs: 0,
      modelDownloadMs: 0,
      sessionInitMs: 0,
      preprocessMs: 0,
      inferenceMs: 27.654,
      outputReadbackMs: 7.778,
      matteMs: 0,
      compositeMs: 0,
      exportMs: 0,
      totalMs: 55.432,
      sessionReused: true,
    });
  });

  test("accumulates repeated spans and ignores duplicate stop calls", () => {
    let current = 0;
    const recorder = createRemovalTimingRecorder(() => current);

    const stopFirst = recorder.begin("preprocessMs");
    current = 5;
    stopFirst();
    current = 8;
    stopFirst();

    const stopSecond = recorder.begin("preprocessMs");
    current = 12.5;
    stopSecond();

    current = 15;
    const timings = recorder.finish();

    expect(timings.preprocessMs).toBe(9.5);
    expect(timings.totalMs).toBe(15);
    expect(timings.sessionReused).toBe(false);
  });
});
