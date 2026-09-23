import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import { removeBackgroundWebGpuWithStrategy } from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const ModeSchema = Schema.Union(
  Schema.Literal("default"),
  Schema.Literal(64),
);

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
});

const ConfigSchema = Schema.Struct({
  cases: Schema.Array(
    BenchmarkCaseSchema,
  ),
  runsPerCase: Schema.Number,
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
  readonly caseId: string;
  readonly run: number;
  readonly timings: RemovalTimings;
};

type PrimeRecord = {
  readonly schemaVersion: 1;
  readonly mode: Mode;
  readonly caseId: string;
  readonly timings: RemovalTimings;
};

type FailureRecord = {
  readonly schemaVersion: 1;
  readonly mode: Mode;
  readonly caseId: string;
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
  readonly strategy: "no-capture-reuse";
  readonly mode: Mode;
  readonly runsPerCase: number;
  readonly prime: PrimeRecord;
  readonly runs:
    readonly RunRecord[];
};

type RequestBody =
  | RunRecord
  | PrimeRecord
  | FailureRecord;

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (
  status === null
) {
  throw new Error(
    "Six-image dispatch benchmark status element is missing.",
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

    if (
      value === null ||
      value === "default"
    ) {
      return "default";
    }

    return Schema.decodeUnknownSync(
      ModeSchema,
    )(
      Number.parseInt(
        value,
        10,
      ),
    );
  };

const postJson = async (
  path: string,
  value: RequestBody,
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

const makeFile = (
  source: Blob,
  id: string,
): File =>
  new File(
    [source],
    `${id}.png`,
    {
      type:
        source.type ||
        "image/png",
    },
  );

const remove = async (
  source: Blob,
  caseId: string,
  mode: Mode,
) =>
  Effect.runPromise(
    removeBackgroundWebGpuWithStrategy(
      makeFile(
        source,
        caseId,
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

const uploadOutput = async (
  mode: Mode,
  caseIndex: number,
  runIndex: number,
  blob: Blob,
): Promise<void> => {
  const response =
    await fetch(
      `/output/${String(
        mode,
      )}/${caseIndex}/${runIndex}`,
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
  mode: Mode,
  benchmarkCase:
    Schema.Schema.Type<
      typeof BenchmarkCaseSchema
    >,
  caseIndex: number,
  runIndex: number,
  source: Blob,
  timeoutMs: number,
): Promise<RunRecord> => {
  const label =
    `${String(
      mode,
    )} ${benchmarkCase.id} run ${runIndex + 1}`;

  const startedAt =
    performance.now();

  try {
    const outcome =
      await withTimeout(
        remove(
          source,
          benchmarkCase.id,
          mode,
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

    if (
      !outcome.result.timings
        .sessionReused
    ) {
      throw new Error(
        `${label} did not reuse the primed session.`,
      );
    }

    await uploadOutput(
      mode,
      caseIndex,
      runIndex,
      outcome.result.blob,
    );

    const record:
      RunRecord = {
        schemaVersion: 1,
        mode,
        caseId:
          benchmarkCase.id,
        run:
          runIndex + 1,
        timings:
          outcome.result.timings,
      };

    await postJson(
      "/run",
      record,
    );

    writeStatus(
      `${label}: ${record.timings.totalMs.toFixed(
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
        schemaVersion: 1,
        mode,
        caseId:
          benchmarkCase.id,
        run:
          runIndex + 1,
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

const runPrime = async (
  mode: Mode,
  benchmarkCase:
    Schema.Schema.Type<
      typeof BenchmarkCaseSchema
    >,
  source: Blob,
  timeoutMs: number,
): Promise<PrimeRecord> => {
  const label =
    `${String(
      mode,
    )} prime ${benchmarkCase.id}`;

  const startedAt =
    performance.now();

  try {
    const outcome =
      await withTimeout(
        remove(
          source,
          benchmarkCase.id,
          mode,
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

    if (
      outcome.result.timings
        .sessionReused
    ) {
      throw new Error(
        `${label} unexpectedly reused a session.`,
      );
    }

    const record:
      PrimeRecord = {
        schemaVersion: 1,
        mode,
        caseId:
          benchmarkCase.id,
        timings:
          outcome.result.timings,
      };

    await postJson(
      "/prime",
      record,
    );

    writeStatus(
      `${label}: ${record.timings.totalMs.toFixed(
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
        schemaVersion: 1,
        mode,
        caseId:
          benchmarkCase.id,
        run:
          "prime",
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
        `Could not load six-image dispatch config: HTTP ${configResponse.status}.`,
      );
    }

    const config =
      Schema.decodeUnknownSync(
        ConfigSchema,
      )(
        await configResponse.json(),
      );

    if (
      config.cases.length === 0
    ) {
      throw new Error(
        "Six-image dispatch config has no cases.",
      );
    }

    const mode =
      modeFromLocation();

    if (
      !config.modes.includes(
        mode,
      )
    ) {
      throw new Error(
        `Mode ${String(
          mode,
        )} is not configured.`,
      );
    }

    if (
      resolveDefaultWebGpuSessionStrategy(
        navigator.userAgent,
      ) !==
      "no-capture-reuse"
    ) {
      throw new Error(
        "Six-image dispatch benchmark must run on Safari's no-capture path.",
      );
    }

    const sources =
      await Promise.all(
        config.cases.map(
          async (
            benchmarkCase,
          ) => {
            const response =
              await fetch(
                benchmarkCase.inputUrl,
                {
                  cache:
                    "no-store",
                },
              );

            if (
              !response.ok
            ) {
              throw new Error(
                `Could not load ${benchmarkCase.id}: HTTP ${response.status}.`,
              );
            }

            return response.blob();
          },
        ),
      );

    const prime =
      await runPrime(
        mode,
        config.cases[0],
        sources[0],
        config.timeoutMs,
      );

    const runs:
      RunRecord[] = [];

    for (
      let caseIndex = 0;
      caseIndex <
      config.cases.length;
      caseIndex += 1
    ) {
      const benchmarkCase =
        config.cases[
          caseIndex
        ];

      const source =
        sources[
          caseIndex
        ];

      for (
        let runIndex = 0;
        runIndex <
        config.runsPerCase;
        runIndex += 1
      ) {
        runs.push(
          await runRemoval(
            mode,
            benchmarkCase,
            caseIndex,
            runIndex,
            source,
            config.timeoutMs,
          ),
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
        strategy:
          "no-capture-reuse",
        mode,
        runsPerCase:
          config.runsPerCase,
        prime,
        runs,
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
        "Six-image dispatch benchmark passed.",
      );

      return;
    }

    if (
      completion.nextMode ===
      undefined
    ) {
      throw new Error(
        "Server did not return the next dispatch mode.",
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
      "SIX-IMAGE DISPATCH BENCHMARK FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
