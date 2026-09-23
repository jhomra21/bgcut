import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import {
  removeBackgroundWebGpuWithStrategy,
  type WebGpuPreferredLayout,
} from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const PreferredLayoutSchema = Schema.Literal(
  "default",
  "NCHW",
);

const ConfigSchema = Schema.Struct({
  caseId: Schema.String,
  inputUrl: Schema.String,
  measuredRuns: Schema.Number,
  timeoutMs: Schema.Number,
  layouts: Schema.Array(
    PreferredLayoutSchema,
  ),
});

type RunRecord = {
  readonly label: string;
  readonly layout: WebGpuPreferredLayout;
  readonly run: number;
  readonly prime: boolean;
  readonly elapsedMs: number;
  readonly timings: RemovalTimings;
};

type FailureRecord = {
  readonly label: string;
  readonly layout: WebGpuPreferredLayout;
  readonly run: number;
  readonly prime: boolean;
  readonly elapsedMs: number;
  readonly message: string;
  readonly stack: string;
};

type LayoutReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly caseId: string;
  readonly strategy: "no-capture-reuse";
  readonly timeoutMs: number;
  readonly layouts:
    readonly WebGpuPreferredLayout[];
  readonly attempts:
    readonly RunRecord[];
};

type LayoutRequestBody =
  | RunRecord
  | FailureRecord
  | LayoutReport;

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (
  status === null
) {
  throw new Error(
    "WebGPU layout benchmark status element is missing.",
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
  value: LayoutRequestBody,
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

  if (
    !response.ok
  ) {
    throw new Error(
      await response.text(),
    );
  }
};

const uploadOutput = async (
  label: string,
  blob: Blob,
): Promise<void> => {
  const response =
    await fetch(
      `/output/${label}`,
      {
        method: "POST",
        body: blob,
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      await response.text(),
    );
  }
};

const runRemoval = async (
  source: Blob,
  caseId: string,
  layout:
    WebGpuPreferredLayout,
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
      layout,
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
    | ReturnType<
        typeof setTimeout
      >
    | undefined;

  const timeoutPromise =
    new Promise<T>(
      (_, reject) => {
        timeout =
          setTimeout(
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
      timeout !==
      undefined
    ) {
      clearTimeout(
        timeout,
      );
    }
  }
};

const runAttempt = async (
  label: string,
  layout:
    WebGpuPreferredLayout,
  run: number,
  prime: boolean,
  source: Blob,
  caseId: string,
  timeoutMs: number,
): Promise<RunRecord> => {
  const startedAt =
    performance.now();

  writeStatus(
    `${label}: started.`,
  );

  try {
    const outcome =
      await withTimeout(
        runRemoval(
          source,
          caseId,
          layout,
        ),
        timeoutMs,
        label,
      );

    if (
      !outcome.ok
    ) {
      throw new Error(
        outcome.message,
      );
    }

    const expectedReuse =
      !prime;

    if (
      outcome.result.timings
        .sessionReused !==
      expectedReuse
    ) {
      throw new Error(
        `${label} session reuse was ${String(
          outcome.result.timings
            .sessionReused,
        )}, expected ${String(
          expectedReuse,
        )}.`,
      );
    }

    const elapsedMs =
      performance.now() -
      startedAt;

    await uploadOutput(
      label,
      outcome.result.blob,
    );

    const record:
      RunRecord = {
        label,
        layout,
        run,
        prime,
        elapsedMs,
        timings:
          outcome.result.timings,
      };

    await postJson(
      "/run",
      record,
    );

    writeStatus(
      `${label}: ${outcome.result.timings.totalMs.toFixed(
        1,
      )} ms.`,
    );

    return record;
  } catch (error) {
    const parsed =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    const failure:
      FailureRecord = {
        label,
        layout,
        run,
        prime,
        elapsedMs:
          performance.now() -
          startedAt,
        message:
          parsed.message,
        stack:
          parsed.stack ?? "",
      };

    await postJson(
      "/failure",
      failure,
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
        `Could not load WebGPU layout benchmark config: HTTP ${configResponse.status}.`,
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
        "WebGPU layout benchmark must run on the Safari no-capture path.",
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
      RunRecord[] = [];

    for (
      const layout of
        config.layouts
    ) {
      attempts.push(
        await runAttempt(
          `${layout}-prime`,
          layout,
          0,
          true,
          source,
          config.caseId,
          config.timeoutMs,
        ),
      );

      for (
        let runIndex = 1;
        runIndex <=
        config.measuredRuns;
        runIndex += 1
      ) {
        attempts.push(
          await runAttempt(
            `${layout}-run-${runIndex}`,
            layout,
            runIndex,
            false,
            source,
            config.caseId,
            config.timeoutMs,
          ),
        );
      }
    }

    const report:
      LayoutReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        userAgent:
          navigator.userAgent,
        caseId:
          config.caseId,
        strategy:
          "no-capture-reuse",
        timeoutMs:
          config.timeoutMs,
        layouts:
          config.layouts,
        attempts,
      };

    await postJson(
      "/report",
      report,
    );

    writeStatus("");
    writeStatus(
      "WebGPU layout benchmark passed.",
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
      "WEBGPU LAYOUT BENCHMARK FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
