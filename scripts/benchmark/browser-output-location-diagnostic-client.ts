import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import {
  removeBackgroundWebGpuWithStrategy,
  type WebGpuDiagnosticObserver,
  type WebGpuDiagnosticStage,
} from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const ConfigSchema = Schema.Struct({
  caseId: Schema.String,
  inputUrl: Schema.String,
  measuredRuns: Schema.Number,
  timeoutMs: Schema.Number,
});

type AttemptRecord = {
  readonly label: string;
  readonly lastStage:
    | WebGpuDiagnosticStage
    | "attempt-start";
  readonly elapsedMs: number;
  readonly timings: RemovalTimings;
};

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (status === null) {
  throw new Error(
    "CPU-output diagnostic status element is missing.",
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
  const response = await fetch(
    path,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
      },
      body: JSON.stringify(value),
    },
  );

  if (!response.ok) {
    throw new Error(
      await response.text(),
    );
  }
};

const sendProgress = (
  label: string,
  stage: WebGpuDiagnosticStage,
  elapsedMs: number,
): void => {
  const queued =
    navigator.sendBeacon(
      "/progress",
      new Blob(
        [
          JSON.stringify({
            label,
            stage,
            elapsedMs,
            recordedAt:
              new Date().toISOString(),
          }),
        ],
        {
          type:
            "application/json",
        },
      ),
    );

  if (!queued) {
    writeStatus(
      `${label}: could not queue progress marker ${stage}.`,
    );
  }
};

const uploadOutput = async (
  label: string,
  blob: Blob,
): Promise<void> => {
  const response = await fetch(
    `/output/${label}`,
    {
      method: "POST",
      body: blob,
    },
  );

  if (!response.ok) {
    throw new Error(
      await response.text(),
    );
  }
};

const runRemoval = async (
  source: Blob,
  caseId: string,
  diagnosticObserver:
    WebGpuDiagnosticObserver,
) =>
  Effect.runPromise(
    removeBackgroundWebGpuWithStrategy(
      new File(
        [source],
        `${caseId}.png`,
        {
          type:
            source.type ||
            "image/png",
        },
      ),
      "no-capture-reuse",
      "cpu",
      diagnosticObserver,
    ).pipe(
      Effect.match({
        onFailure: (error) => ({
          ok: false as const,
          message:
            formatBackgroundRemovalError(
              error,
            ),
        }),
        onSuccess: (result) => ({
          ok: true as const,
          result,
        }),
      }),
    ),
  );

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeout:
    | ReturnType<typeof setTimeout>
    | undefined;

  const timeoutPromise =
    new Promise<T>(
      (_, reject) => {
        timeout = setTimeout(
          () => {
            reject(
              new Error(
                `${label} exceeded ${timeoutMs} ms.`,
              ),
            );
          },
          timeoutMs,
        );
      },
    );

  try {
    return await Promise.race([
      operation,
      timeoutPromise,
    ]);
  } finally {
    if (
      timeout !== undefined
    ) {
      clearTimeout(timeout);
    }
  }
};

const runAttempt = async (
  label: string,
  source: Blob,
  caseId: string,
  timeoutMs: number,
  expectReuse: boolean,
): Promise<AttemptRecord> => {
  let lastStage:
    | WebGpuDiagnosticStage
    | "attempt-start" =
    "attempt-start";

  const startedAt =
    performance.now();

  await postJson(
    "/attempt",
    {
      label,
      caseId,
      expectReuse,
      startedAt:
        new Date().toISOString(),
    },
  );

  writeStatus(
    `${label}: started.`,
  );

  const diagnosticObserver:
    WebGpuDiagnosticObserver = (
      stage,
    ) => {
      lastStage = stage;

      sendProgress(
        label,
        stage,
        performance.now() -
          startedAt,
      );
    };

  try {
    const outcome =
      await withTimeout(
        runRemoval(
          source,
          caseId,
          diagnosticObserver,
        ),
        timeoutMs,
        label,
      );

    if (!outcome.ok) {
      throw new Error(
        outcome.message,
      );
    }

    const elapsedMs =
      performance.now() -
      startedAt;

    if (
      outcome.result.timings
        .sessionReused !==
      expectReuse
    ) {
      throw new Error(
        `${label} session reuse was ${String(
          outcome.result.timings
            .sessionReused,
        )}, expected ${String(
          expectReuse,
        )}.`,
      );
    }

    await uploadOutput(
      label,
      outcome.result.blob,
    );

    const record: AttemptRecord = {
      label,
      lastStage,
      elapsedMs,
      timings:
        outcome.result.timings,
    };

    await postJson(
      "/run",
      record,
    );

    writeStatus(
      `${label}: ${elapsedMs.toFixed(
        1,
      )} ms, last stage ${lastStage}.`,
    );

    return record;
  } catch (error) {
    const parsed =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    await postJson(
      "/failure",
      {
        label,
        caseId,
        lastStage,
        elapsedMs:
          performance.now() -
          startedAt,
        message:
          parsed.message,
        stack:
          parsed.stack ?? "",
      },
    );

    throw parsed;
  }
};

const main =
  async (): Promise<void> => {
    const configResponse =
      await fetch(
        "/config.json",
      );

    if (
      !configResponse.ok
    ) {
      throw new Error(
        `Could not load CPU-output diagnostic config: HTTP ${configResponse.status}.`,
      );
    }

    const config =
      Schema.decodeUnknownSync(
        ConfigSchema,
      )(
        await configResponse.json(),
      );

    if (
      resolveDefaultWebGpuSessionStrategy(
        navigator.userAgent,
      ) !==
      "no-capture-reuse"
    ) {
      throw new Error(
        "CPU-output diagnostic must run on the Safari no-capture path.",
      );
    }

    const inputResponse =
      await fetch(
        config.inputUrl,
        {
          cache:
            "no-store",
        },
      );

    if (
      !inputResponse.ok
    ) {
      throw new Error(
        `Could not load ${config.caseId}: HTTP ${inputResponse.status}.`,
      );
    }

    const source =
      await inputResponse.blob();

    const attempts:
      AttemptRecord[] = [];

    attempts.push(
      await runAttempt(
        "prime",
        source,
        config.caseId,
        config.timeoutMs,
        false,
      ),
    );

    for (
      let runIndex = 0;
      runIndex <
      config.measuredRuns;
      runIndex += 1
    ) {
      attempts.push(
        await runAttempt(
          `run-${runIndex + 1}`,
          source,
          config.caseId,
          config.timeoutMs,
          true,
        ),
      );
    }

    await postJson(
      "/report",
      {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        userAgent:
          navigator.userAgent,
        caseId:
          config.caseId,
        outputLocation:
          "cpu",
        strategy:
          "no-capture-reuse",
        timeoutMs:
          config.timeoutMs,
        attempts,
      },
    );

    writeStatus("");
    writeStatus(
      "CPU-output diagnostic passed.",
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
      "CPU-OUTPUT DIAGNOSTIC FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
