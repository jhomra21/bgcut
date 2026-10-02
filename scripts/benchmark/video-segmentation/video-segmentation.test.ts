import { describe, expect, test } from "bun:test";

import {
  VIDEO_SEGMENTATION_CANDIDATES,
  reportedModelSizeMb,
} from "./candidates";
import {
  binaryMaskIou,
  maskAreaFraction,
  summarizeVideoSegmentationFrames,
} from "./report";

describe("video segmentation bake-off", () => {
  test("compares the two full temporal ONNX candidates on the same input geometry", () => {
    const sam = VIDEO_SEGMENTATION_CANDIDATES["sam21-tiny"];
    const edge = VIDEO_SEGMENTATION_CANDIDATES.edgetam;

    expect(sam.inputSize).toBe(1024);
    expect(edge.inputSize).toBe(1024);
    expect(sam.artifacts.map((artifact) => artifact.role)).toEqual(
      edge.artifacts.map((artifact) => artifact.role),
    );
    expect(sam.license).toBe("Apache-2.0");
    expect(edge.license).toBe("Apache-2.0");
    expect(reportedModelSizeMb(edge)).toBeLessThan(
      reportedModelSizeMb(sam),
    );
  });

  test("computes foreground area and temporal IoU from model logits", () => {
    const left = {
      logits: new Float32Array([1, 1, -1, -1]),
      width: 2,
      height: 2,
    };
    const right = {
      logits: new Float32Array([1, -1, 1, -1]),
      width: 2,
      height: 2,
    };

    expect(maskAreaFraction(left)).toBe(0.5);
    expect(binaryMaskIou(left, right)).toBeCloseTo(1 / 3);
  });

  test("summarizes inference timing without mixing decode time into tracked FPS", () => {
    const summary = summarizeVideoSegmentationFrames([
      {
        frameIndex: 0,
        timestamp: 0,
        decodeMs: 4,
        inferenceMs: 20,
        maskAreaFraction: 0.5,
        temporalMaskIou: null,
        modelIou: 0.9,
        objectScore: 1,
      },
      {
        frameIndex: 1,
        timestamp: 1 / 30,
        decodeMs: 6,
        inferenceMs: 30,
        maskAreaFraction: 0.51,
        temporalMaskIou: 0.8,
        modelIou: 0.88,
        objectScore: 0.95,
      },
    ]);

    expect(summary.meanDecodeMs).toBe(5);
    expect(summary.meanInferenceMs).toBe(25);
    expect(summary.p50InferenceMs).toBe(20);
    expect(summary.p95InferenceMs).toBe(30);
    expect(summary.trackedFps).toBe(40);
    expect(summary.meanTemporalMaskIou).toBe(0.8);
  });
});
