import {
  VIDEO_SEGMENTATION_CANDIDATES,
} from "./candidates";
import {
  createVideoSegmentationAdapter,
} from "./adapter";
import {
  openMediaBunnyVideoSource,
} from "./media-source";
import {
  SAM21_FP32_REFERENCE,
} from "./references";
import {
  runVideoSegmentationBenchmark,
} from "./runner";

import type {
  VideoSegmentationBenchmarkReport,
  VideoSegmentationCandidate,
} from "./types";

type TemporalSmokeCandidate =
  | "edgetam"
  | "sam21-fp32"
  | "sam21-primary";

type TemporalSmokeResult = {
  readonly schemaVersion: 1;
  readonly candidate:
    TemporalSmokeCandidate;
  readonly report:
    VideoSegmentationBenchmarkReport;
};

const SMOKE_FRAMES = 6;

type TemporalSmokeFailure = {
  readonly candidate:
    TemporalSmokeCandidate;
  readonly message: string;
  readonly stack: string;
};

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (status === null) {
  throw new Error(
    "Video temporal smoke status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
};

const candidateFromLocation =
  (): TemporalSmokeCandidate => {
    const candidate =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "candidate",
      );

    switch (
      candidate
    ) {
      case "edgetam":
      case "sam21-fp32":
      case "sam21-primary":
        return candidate;

      default:
        throw new Error(
          `Unknown temporal smoke candidate "${candidate}".`,
        );
    }
  };

const modelFor = (
  candidate:
    TemporalSmokeCandidate,
): VideoSegmentationCandidate => {
  switch (
    candidate
  ) {
    case "edgetam":
      return VIDEO_SEGMENTATION_CANDIDATES
        .edgetam;

    case "sam21-fp32":
      return SAM21_FP32_REFERENCE;

    case "sam21-primary":
      return VIDEO_SEGMENTATION_CANDIDATES[
        "sam21-tiny"
      ];
  }
};

const postJson = async (
  path: string,
  value:
    | TemporalSmokeResult
    | TemporalSmokeFailure,
): Promise<void> => {
  const response =
    await fetch(
      path,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify(
            value,
          ),
      },
    );

  if (!response.ok) {
    throw new Error(
      await response.text(),
    );
  }
};

const verifyReport = (
  report:
    VideoSegmentationBenchmarkReport,
): void => {
  if (
    report.frames.length !==
      SMOKE_FRAMES ||
    report.decodedFrames !==
      SMOKE_FRAMES
  ) {
    throw new Error(
      `Temporal smoke expected ${SMOKE_FRAMES} decoded masks, received ${report.frames.length} reports from ${report.decodedFrames} decoded frames.`,
    );
  }

  for (
    const frame of
    report.frames
  ) {
    if (
      !Number.isFinite(
        frame.inferenceMs,
      ) ||
      frame.inferenceMs <=
        0 ||
      !Number.isFinite(
        frame.maskAreaFraction,
      ) ||
      frame.maskAreaFraction <
        0 ||
      frame.maskAreaFraction >
        1
    ) {
      throw new Error(
        `Temporal smoke produced an invalid frame report at frame ${frame.frameIndex}.`,
      );
    }
  }
};

const main =
  async (): Promise<void> => {
    const requested =
      candidateFromLocation();

    const candidate =
      modelFor(
        requested,
      );

    writeStatus(
      `Loading fixture for ${candidate.label}.`,
    );

    const fixtureResponse =
      await fetch(
        "/fixture.mp4",
        {
          cache:
            "no-store",
        },
      );

    if (
      !fixtureResponse.ok
    ) {
      throw new Error(
        `Could not load temporal smoke fixture: HTTP ${fixtureResponse.status}.`,
      );
    }

    const fixture =
      await fixtureResponse.blob();

    const source =
      await openMediaBunnyVideoSource(
        fixture,
      );

    try {
      writeStatus(
        `Running ${candidate.label} on ${source.info.width}x${source.info.height} video.`,
      );

      const report =
        await runVideoSegmentationBenchmark(
          candidate,
          source,
          createVideoSegmentationAdapter,
          {
            sampleFps: 6,
            maxFrames:
              SMOKE_FRAMES,
            seedIndex: 0,
            prompt: {
              points: [
                {
                  x: 0.5,
                  y: 0.5,
                  label: 1,
                },
              ],
            },
          },
        );

      verifyReport(
        report,
      );

      await postJson(
        "/result",
        {
          schemaVersion: 1,
          candidate:
            requested,
          report,
        },
      );

      writeStatus(
        `Temporal smoke passed: seed ${report.frames[0]?.inferenceMs.toFixed(
          1,
        )} ms, warm tracked p50 ${report.summary.p50TrackedInferenceMs.toFixed(
          1,
        )} ms, tracked FPS ${report.summary.trackedFps.toFixed(
          2,
        )}.`,
      );
    } finally {
      source.close();
    }
  };

void main().catch(
  (error) => {
    const requested =
      (() => {
        try {
          return candidateFromLocation();
        } catch {
          return "edgetam" as const;
        }
      })();

    const parsed =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    writeStatus("");
    writeStatus(
      "VIDEO TEMPORAL SMOKE FAILED",
    );
    writeStatus(
      parsed.message,
    );

    void postJson(
      "/failure",
      {
        candidate:
          requested,
        message:
          parsed.message,
        stack:
          parsed.stack ??
          "",
      },
    );
  },
);
