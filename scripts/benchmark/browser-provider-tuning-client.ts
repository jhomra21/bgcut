import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import {
  removeBackgroundWebGpuWithStrategy,
  type WebGpuProviderTuning,
} from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const ModeSchema = Schema.Literal(
  "default",
  "wgpu-only",
  "storage-simple",
  "combined",
);

const ConfigSchema = Schema.Struct({
  caseId: Schema.String,
  inputUrl: Schema.String,
  runs: Schema.Number,
  timeoutMs: Schema.Number,
  modes: Schema.Array(
    ModeSchema,
  ),
});

const CompletionSchema = Schema.Struct({
  done: Schema.Boolean,
  nextMode: Schema.optional(
    ModeSchema,
  ),
});

type Mode =
  Schema.Schema.Type<
    typeof ModeSchema
  >;

type RunRecord = {
  readonly schemaVersion: 1;
  readonly mode: Mode;
  readonly run: number;
  readonly timings: RemovalTimings;
};

type PrimeRecord = {
  readonly schemaVersion: 1;
  readonly mode: Mode;
  readonly timings: RemovalTimings;
};

type FailureRecord = {
  readonly schemaVersion: 1;
  readonly mode: Mode;
  readonly run:
    | number
    | "prime";
  readonly elapsedMs: number;
  readonly message: string;
  readonly stack: string;
};

type ModeReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly caseId: string;
  readonly mode: Mode;
  readonly runs: readonly RunRecord[];
  readonly prime: PrimeRecord;
};

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (
  status === null
) {
  throw new Error(
    "Provider-tuning benchmark status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
};

const modeFromLocation =
  (): Mode => {
    const value =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "mode",
      );

    return Schema.decodeUnknownSync(
      ModeSchema,
    )(
      value ??
        "default",
    );
  };

const tuningForMode = (
  mode: Mode,
): WebGpuProviderTuning => {
  switch (mode) {
    case "default":
      return {};
    case "wgpu-only":
      return {
        validationMode:
          "wgpuOnly",
      };
    case "storage-simple":
      return {
        storageBufferCacheMode:
          "simple",
      };
    case "combined":
      return {
        validationMode:
          "wgpuOnly",
        storageBufferCacheMode:
          "simple",
      };
  }
};

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
      timeout !== undefined
    ) {
      clearTimeout(
        timeout,
      );
    }
  }
};

const remove = async (
  source: Blob,
  caseId: string,
  mode: Mode,
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
      tuningForMode(mode),
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

const postJson = async (
  path: string,
  value:
    | RunRecord
    | PrimeRecord
    | FailureRecord,
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
  mode: Mode,
  run: number,
  blob: Blob,
): Promise<void> => {
  const response =
    await fetch(
      `/output/${mode}/${run}`,
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

const recordFailure = async (
  mode: Mode,
  run:
    | number
    | "prime",
  startedAt: number,
  error: Error,
): Promise<never> => {
  const failure:
    FailureRecord = {
      schemaVersion: 1,
      mode,
      run,
      elapsedMs:
        performance.now() -
        startedAt,
      message:
        error.message,
      stack:
        error.stack ?? "",
    };

  await postJson(
    "/failure",
    failure,
  );

  throw error;
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
        `Could not load provider-tuning config: HTTP ${configResponse.status}.`,
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
        `Provider-tuning mode ${mode} is not configured.`,
      );
    }

    if (
      resolveDefaultWebGpuSessionStrategy(
        navigator.userAgent,
      ) !==
      "no-capture-reuse"
    ) {
      throw new Error(
        "Provider-tuning benchmark must run on Safari's no-capture path.",
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

    const primeStartedAt =
      performance.now();

    let primeRecord:
      | PrimeRecord
      | undefined;

    try {
      const prime =
        await withTimeout(
          remove(
            source,
            config.caseId,
            mode,
          ),
          config.timeoutMs,
          `${mode} prime`,
        );

      if (
        !prime.ok
      ) {
        throw new Error(
          prime.message,
        );
      }

      if (
        prime.result.timings
          .sessionReused
      ) {
        throw new Error(
          `${mode} prime unexpectedly reused a session.`,
        );
      }

      primeRecord = {
        schemaVersion: 1,
        mode,
        timings:
          prime.result.timings,
      };

      await postJson(
        "/prime",
        primeRecord,
      );

      writeStatus(
        `${mode} prime: ${primeRecord.timings.totalMs.toFixed(
          1,
        )} ms.`,
      );
    } catch (error) {
      const parsed =
        error instanceof Error
          ? error
          : new Error(
              String(error),
            );

      await recordFailure(
        mode,
        "prime",
        primeStartedAt,
        parsed,
      );
    }

    if (
      primeRecord ===
      undefined
    ) {
      throw new Error(
        "Provider-tuning prime did not produce a record.",
      );
    }

    const runs:
      RunRecord[] = [];

    for (
      let run = 1;
      run <=
      config.runs;
      run += 1
    ) {
      const startedAt =
        performance.now();

      try {
        const outcome =
          await withTimeout(
            remove(
              source,
              config.caseId,
              mode,
            ),
            config.timeoutMs,
            `${mode} run ${run}`,
          );

        if (
          !outcome.ok
        ) {
          throw new Error(
            outcome.message,
          );
        }

        if (
          !outcome.result.timings
            .sessionReused
        ) {
          throw new Error(
            `${mode} run ${run} did not reuse the primed session.`,
          );
        }

        await uploadOutput(
          mode,
          run,
          outcome.result.blob,
        );

        const record:
          RunRecord = {
            schemaVersion: 1,
            mode,
            run,
            timings:
              outcome.result
                .timings,
          };

        runs.push(
          record,
        );

        await postJson(
          "/run",
          record,
        );

        writeStatus(
          `${mode} run ${run}: ${record.timings.totalMs.toFixed(
            1,
          )} ms.`,
        );
      } catch (error) {
        const parsed =
          error instanceof Error
            ? error
            : new Error(
                String(error),
              );

        await recordFailure(
          mode,
          run,
          startedAt,
          parsed,
        );
      }
    }

    const report:
      ModeReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        userAgent:
          navigator.userAgent,
        caseId:
          config.caseId,
        mode,
        runs,
        prime:
          primeRecord,
      };

    const response =
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
      !response.ok
    ) {
      throw new Error(
        await response.text(),
      );
    }

    const completion =
      Schema.decodeUnknownSync(
        CompletionSchema,
      )(
        await response.json(),
      );

    if (
      completion.done
    ) {
      writeStatus("");
      writeStatus(
        "Provider-tuning benchmark passed.",
      );

      return;
    }

    if (
      completion.nextMode ===
      undefined
    ) {
      throw new Error(
        "Provider-tuning server did not return the next mode.",
      );
    }

    globalThis.location.replace(
      `/?mode=${encodeURIComponent(
        completion.nextMode,
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
      "PROVIDER-TUNING BENCHMARK FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
