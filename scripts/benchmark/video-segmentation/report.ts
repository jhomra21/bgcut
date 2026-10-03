import type {
  VideoSegmentationBenchmarkReport,
  VideoSegmentationFrameReport,
  VideoSegmentationMask,
} from "./types";

const percentile = (
  values: readonly number[],
  fraction: number,
): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);

  const index = Math.min(
    sorted.length - 1,
    Math.max(
      0,
      Math.ceil(sorted.length * fraction) - 1,
    ),
  );

  return sorted[index] ?? 0;
};

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export const maskAreaFraction = (
  mask: VideoSegmentationMask,
): number => {
  if (mask.logits.length === 0) {
    return 0;
  }

  let foreground = 0;

  for (const logit of mask.logits) {
    if (logit > 0) {
      foreground += 1;
    }
  }

  return foreground / mask.logits.length;
};

export const binaryMaskIou = (
  left: VideoSegmentationMask,
  right: VideoSegmentationMask,
): number | null => {
  if (
    left.width !== right.width ||
    left.height !== right.height ||
    left.logits.length !== right.logits.length
  ) {
    return null;
  }

  let intersection = 0;
  let union = 0;

  for (let index = 0; index < left.logits.length; index += 1) {
    const leftForeground = (left.logits[index] ?? 0) > 0;
    const rightForeground = (right.logits[index] ?? 0) > 0;

    if (leftForeground && rightForeground) {
      intersection += 1;
    }

    if (leftForeground || rightForeground) {
      union += 1;
    }
  }

  return union === 0 ? 1 : intersection / union;
};

export const summarizeVideoSegmentationFrames = (
  frames: readonly VideoSegmentationFrameReport[],
  seedFrame: number,
): VideoSegmentationBenchmarkReport["summary"] => {
  const decode = frames.map((frame) => frame.decodeMs);
  const inference = frames.map((frame) => frame.inferenceMs);

  const trackedInference =
    frames
      .filter(
        (frame) =>
          frame.frameIndex !==
          seedFrame,
      )
      .map(
        (frame) =>
          frame.inferenceMs,
      );

  const temporalIou = frames.flatMap((frame) =>
    frame.temporalMaskIou === null
      ? []
      : [frame.temporalMaskIou],
  );

  const totalTrackedInferenceMs =
    trackedInference.reduce(
      (sum, duration) =>
        sum +
        duration,
      0,
    );

  return {
    meanDecodeMs: mean(decode),
    meanInferenceMs: mean(inference),
    p50InferenceMs: percentile(inference, 0.5),
    p95InferenceMs: percentile(inference, 0.95),
    meanTrackedInferenceMs:
      mean(
        trackedInference,
      ),
    p50TrackedInferenceMs:
      percentile(
        trackedInference,
        0.5,
      ),
    p95TrackedInferenceMs:
      percentile(
        trackedInference,
        0.95,
      ),
    trackedFps:
      totalTrackedInferenceMs ===
      0
        ? 0
        : (trackedInference.length *
            1000) /
          totalTrackedInferenceMs,
    meanTemporalMaskIou:
      temporalIou.length === 0
        ? null
        : mean(temporalIou),
  };
};
