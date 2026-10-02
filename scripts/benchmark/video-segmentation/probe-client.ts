import {
  VIDEO_SEGMENTATION_CANDIDATES,
} from "./candidates";
import {
  probeVideoSegmentationCandidate,
  type VideoModelProbeReport,
} from "./probe";

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (status === null) {
  throw new Error(
    "Video model probe status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
};

const postJson = async (
  path: string,
  value: unknown,
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

const main =
  async (): Promise<void> => {
    if (navigator.gpu === undefined) {
      throw new Error(
        "Video model probe requires WebGPU.",
      );
    }

    const requested =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "candidate",
      );

    const candidates =
      requested === null
        ? Object.values(
            VIDEO_SEGMENTATION_CANDIDATES,
          )
        : Object.values(
            VIDEO_SEGMENTATION_CANDIDATES,
          ).filter(
            (candidate) =>
              candidate.id ===
              requested,
          );

    if (candidates.length === 0) {
      throw new Error(
        `Unknown video segmentation candidate "${requested}".`,
      );
    }

    const reports:
      VideoModelProbeReport[] = [];

    for (
      const candidate of
      candidates
    ) {
      writeStatus(
        `Probe ${candidate.label}.`,
      );

      const report =
        await probeVideoSegmentationCandidate(
          candidate,
          writeStatus,
        );

      reports.push(
        report,
      );

      await postJson(
        "/report",
        report,
      );

      writeStatus(
        `${candidate.label}: ${(
          report.totalBytes /
          1_000_000
        ).toFixed(1)} MB fetched, ${report.totalSessionMs.toFixed(
          1,
        )} ms session compilation.`,
      );
    }

    await postJson(
      "/complete",
      reports,
    );

    writeStatus("");
    writeStatus(
      "Video model probe complete.",
    );
  };

void main().catch(
  (error) => {
    const parsed =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    writeStatus("");
    writeStatus(
      "VIDEO MODEL PROBE FAILED",
    );
    writeStatus(
      parsed.message,
    );

    void postJson(
      "/failure",
      {
        message:
          parsed.message,
        stack:
          parsed.stack ?? "",
      },
    );
  },
);
