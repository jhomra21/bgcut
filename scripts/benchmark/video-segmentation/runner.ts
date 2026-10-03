import {
  binaryMaskIou,
  maskAreaFraction,
  summarizeVideoSegmentationFrames,
} from "./report";
import { reportedModelSizeMb } from "./candidates";

import type {
  VideoFrameSource,
  VideoSegmentationAdapterFactory,
  VideoSegmentationBenchmarkReport,
  VideoSegmentationBenchmarkSpec,
  VideoSegmentationCandidate,
  VideoSegmentationFrameReport,
  VideoSegmentationMask,
} from "./types";

const benchmarkTimestamps = (
  source: VideoFrameSource,
  spec: VideoSegmentationBenchmarkSpec,
): readonly number[] => {
  if (!Number.isFinite(spec.sampleFps) || spec.sampleFps <= 0) {
    throw new Error("sampleFps must be greater than zero.");
  }

  if (!Number.isInteger(spec.maxFrames) || spec.maxFrames < 1) {
    throw new Error("maxFrames must be a positive integer.");
  }

  const timestamps: number[] = [];
  const step = 1 / spec.sampleFps;
  const end = source.info.firstTimestamp + source.info.duration;

  for (
    let timestamp = source.info.firstTimestamp;
    timestamp < end && timestamps.length < spec.maxFrames;
    timestamp += step
  ) {
    timestamps.push(timestamp);
  }

  return timestamps;
};

export const runVideoSegmentationBenchmark = async (
  candidate: VideoSegmentationCandidate,
  source: VideoFrameSource,
  createAdapter: VideoSegmentationAdapterFactory,
  spec: VideoSegmentationBenchmarkSpec,
): Promise<VideoSegmentationBenchmarkReport> => {
  const timestamps = benchmarkTimestamps(source, spec);

  if (
    spec.seedIndex < 0 ||
    spec.seedIndex >= timestamps.length
  ) {
    throw new Error(
      `seedIndex ${spec.seedIndex} is outside the ${timestamps.length}-frame benchmark.`,
    );
  }

  const loadStartedAt = performance.now();
  const adapter = await createAdapter(candidate);
  const loadMs = performance.now() - loadStartedAt;

  const frames: VideoSegmentationFrameReport[] = [];
  let previousMask: VideoSegmentationMask | undefined;
  let decodedFrames = 0;

  const record = (
    frameIndex: number,
    timestamp: number,
    decodeMs: number,
    inferenceMs: number,
    mask: VideoSegmentationMask,
  ) => {
    frames.push({
      frameIndex,
      timestamp,
      decodeMs,
      inferenceMs,
      maskAreaFraction: maskAreaFraction(mask),
      temporalMaskIou:
        previousMask === undefined
          ? null
          : binaryMaskIou(previousMask, mask),
      modelIou: mask.iou ?? null,
      objectScore: mask.objectScore ?? null,
    });
    previousMask = mask;
  };

  try {
    const seedTimestamp = timestamps[spec.seedIndex];
    const seed = await source.frameAt(seedTimestamp);

    if (seed === null) {
      throw new Error("MediaBunny could not decode the seed frame.");
    }

    decodedFrames += 1;

    try {
      const startedAt = performance.now();

      const mask = await adapter.seed(
        seed.frame,
        spec.prompt,
        spec.seedIndex,
        timestamps.length,
      );

      record(
        spec.seedIndex,
        seed.timestamp,
        seed.decodeMs,
        performance.now() - startedAt,
        mask,
      );
    } finally {
      seed.close();
    }

    let frameIndex = spec.seedIndex + 1;

    for await (
      const decoded of source.framesAt(
        timestamps.slice(spec.seedIndex + 1),
      )
    ) {
      if (decoded !== null) {
        decodedFrames += 1;

        try {
          const startedAt = performance.now();

          const mask = await adapter.track(
            decoded.frame,
            frameIndex,
            timestamps.length,
          );

          record(
            frameIndex,
            decoded.timestamp,
            decoded.decodeMs,
            performance.now() - startedAt,
            mask,
          );
        } finally {
          decoded.close();
        }
      }

      frameIndex += 1;
    }

    return {
      schemaVersion: 1,
      candidate: candidate.id,
      modelReportedSizeMb: reportedModelSizeMb(candidate),
      loadMs,
      width: source.info.width,
      height: source.info.height,
      requestedFrames: timestamps.length,
      decodedFrames,
      seedFrame: spec.seedIndex,
      frames,
      summary:
        summarizeVideoSegmentationFrames(
          frames,
          spec.seedIndex,
        ),
    };
  } finally {
    await adapter.close();
  }
};
