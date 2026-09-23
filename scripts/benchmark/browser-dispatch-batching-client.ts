import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import {
  removeBackgroundWebGpuWithStrategy,
  type WebGpuPendingDispatches,
} from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const PendingDispatchesSchema = Schema.Union(
  Schema.Literal("default"),
  Schema.Literal(8),
  Schema.Literal(32),
  Schema.Literal(64),
);

const ConfigSchema = Schema.Struct({
  caseId: Schema.String,
  inputUrl: Schema.String,
  measuredRuns: Schema.Number,
  timeoutMs: Schema.Number,
  modes: Schema.Array(
    PendingDispatchesSchema,
  ),
});

const CompletionSchema = Schema.Struct({
  done: Schema.Boolean,
  nextMode: Schema.optional(
    PendingDispatchesSchema,
  ),
});

type RunRecord = {
  readonly label: string;
  readonly mode: WebGpuPendingDispatches;
  readonly run: number;
  readonly prime: boolean;
  readonly elapsedMs: number;
  readonly timings: RemovalTimings;
};

type FailureRecord = {
  readonly label: string;
  readonly mode: WebGpuPendingDispatches;
  readonly run: number;
  readonly prime: boolean;
  readonly elapsedMs: number;
  readonly message: string;
  readonly stack: string;
};

type ModeReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly caseId: string;
  readonly strategy: "no-capture-reuse";
  readonly mode: WebGpuPendingDispatches;
  readonly timeoutMs: number;
  readonly attempts: readonly RunRecord[];
};

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (status === null) {
  throw new Error(
    "Dispatch-batching benchmark status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
};

const modeFromLocation =
  (): WebGpuPendingDispatches => {
    const value =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "mode",
      );

    if (
      value === null ||
      value === "default"
    ) {
      return "default";
    }

    const numeric =
      Number.parseInt(
        value,
        10,
      );

    return Schema.decodeUnknownSync(
      PendingDispatchesSchema,
    )(
      numeric,
    );
  };

const postJson = async (
  path: string,
  value:
    RunRecord | FailureRecord,
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

  if (!response.ok) {
    throw new Error(
      await response.text(),
    );
  }
};

const runRemoval = async (
  source: Blob,
  caseId: string,
  mode: WebGpuPendingDispatches,
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
      mode,
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
      timeout !== undefined
    ) {
      clearTimeout(
        timeout,
      );
    }
  }
};

const runAttempt = async (
  label: string,
  mode: WebGpuPendingDispatches,
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
          mode,
        ),
        timeoutMs,
        label,
      );

    if (!outcome.ok) {
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

    const record: RunRecord = {
      label,
      mode,
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

    const failure: FailureRecord = {
      label,
      mode,
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
        `Could not load dispatch-batching config: HTTP ${configResponse.status}.`,
      );
    }

    const config =
      Schema.decodeUnknownSync(
        ConfigSchema,
      )(
        await configResponse.json(),
      );

    const mode =
      modeFromLocation();

    if (
      !config.modes.includes(
        mode,
      )
    ) {
      throw new Error(
        `Dispatch-batching mode ${String(
          mode,
        )} is not configured for this run.`,
      );
    }

    if (
      resolveDefaultWebGpuSessionStrategy(
        navigator.userAgent,
      ) !==
      "no-capture-reuse"
    ) {
      throw new Error(
        "Dispatch-batching benchmark must run on Safari's no-capture path.",
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

    const modeLabel =
      String(mode);

    const attempts:
      RunRecord[] = [];

    attempts.push(
      await runAttempt(
        `${modeLabel}-prime`,
        mode,
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
          `${modeLabel}-run-${runIndex}`,
          mode,
          runIndex,
          false,
          source,
          config.caseId,
          config.timeoutMs,
        ),
      );
    }

    const report: ModeReport = {
      schemaVersion: 1,
      generatedAt:
        new Date().toISOString(),
      userAgent:
        navigator.userAgent,
      caseId:
        config.caseId,
      strategy:
        "no-capture-reuse",
      mode,
      timeoutMs:
        config.timeoutMs,
      attempts,
    };

    const completionResponse =
      await fetch(
        "/mode-report",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify(
              report,
            ),
        },
      );

    if (
      !completionResponse.ok
    ) {
      throw new Error(
        await completionResponse.text(),
      );
    }

    const completion =
      Schema.decodeUnknownSync(
        CompletionSchema,
      )(
        await completionResponse.json(),
      );

    if (
      completion.done
    ) {
      writeStatus("");
      writeStatus(
        "Dispatch-batching benchmark passed.",
      );

      return;
    }

    if (
      completion.nextMode ===
      undefined
    ) {
      throw new Error(
        "Dispatch-batching server did not return the next mode.",
      );
    }

    const nextMode =
      String(
        completion.nextMode,
      );

    writeStatus(
      `Reloading for fresh WebGPU context: ${nextMode}.`,
    );

    globalThis.location.replace(
      `/?mode=${encodeURIComponent(
        nextMode,
      )}`,
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
      "DISPATCH-BATCHING BENCHMARK FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
