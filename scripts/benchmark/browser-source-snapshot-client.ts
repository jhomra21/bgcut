import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import { removeBackgroundWebGpuWithStrategy } from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const StrategySchema = Schema.Literal(
  "late-source",
  "early-source",
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
  targetCaseId: Schema.String,
  strategies: Schema.Array(
    StrategySchema,
  ),
});

const CompletionSchema = Schema.Struct({
  done: Schema.Boolean,
  nextStrategy: Schema.optional(
    StrategySchema,
  ),
});

type Strategy =
  Schema.Schema.Type<
    typeof StrategySchema
  >;

type RunRecord = {
  readonly schemaVersion: 1;
  readonly strategy: Strategy;
  readonly caseId: string;
  readonly run: number;
  readonly timings: RemovalTimings;
};

type StrategyReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly strategy: Strategy;
  readonly targetCaseId: string;
  readonly runsPerCase: number;
  readonly runs: readonly RunRecord[];
};

type FailureRecord = {
  readonly schemaVersion: 1;
  readonly strategy: Strategy;
  readonly caseId: string;
  readonly run:
    | number
    | "prime";
  readonly elapsedMs: number;
  readonly message: string;
  readonly stack: string;
};

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (
  status === null
) {
  throw new Error(
    "Source-snapshot benchmark status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
};

const strategyFromLocation =
  (): Strategy => {
    const value =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "strategy",
      );

    return Schema.decodeUnknownSync(
      StrategySchema,
    )(
      value ??
        "late-source",
    );
  };

const postJson = async (
  path: string,
  value:
    | RunRecord
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
  strategy: Strategy,
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
      "default",
      false,
      strategy ===
        "early-source",
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
  strategy: Strategy,
  run: number,
  blob: Blob,
): Promise<void> => {
  const response =
    await fetch(
      `/output/${strategy}/${run}`,
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
  strategy: Strategy,
  caseId: string,
  run:
    | number
    | "prime",
  startedAt: number,
  error: Error,
): Promise<never> => {
  const failure:
    FailureRecord = {
      schemaVersion: 1,
      strategy,
      caseId,
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
        `Could not load source-snapshot config: HTTP ${configResponse.status}.`,
      );
    }

    const config =
      Schema.decodeUnknownSync(
        ConfigSchema,
      )(
        await configResponse.json(),
      );

    const strategy =
      strategyFromLocation();

    if (
      !config.strategies.includes(
        strategy,
      )
    ) {
      throw new Error(
        `Unknown source-snapshot strategy ${strategy}.`,
      );
    }

    if (
      resolveDefaultWebGpuSessionStrategy(
        navigator.userAgent,
      ) !==
      "no-capture-reuse"
    ) {
      throw new Error(
        "Source-snapshot benchmark must run on Safari's no-capture path.",
      );
    }

    const targetIndex =
      config.cases.findIndex(
        (benchmarkCase) =>
          benchmarkCase.id ===
          config.targetCaseId,
      );

    if (
      targetIndex < 0
    ) {
      throw new Error(
        `Target case ${config.targetCaseId} is not configured.`,
      );
    }

    const activeCases =
      config.cases.slice(
        0,
        targetIndex + 1,
      );

    const sources =
      await Promise.all(
        activeCases.map(
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

    const primeStartedAt =
      performance.now();

    try {
      const prime =
        await withTimeout(
          remove(
            sources[0],
            activeCases[0].id,
            strategy,
          ),
          config.timeoutMs,
          `${strategy} prime`,
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
          "Prime unexpectedly reused a session.",
        );
      }

      writeStatus(
        `${strategy} prime: ${prime.result.timings.totalMs.toFixed(
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
        strategy,
        activeCases[0].id,
        "prime",
        primeStartedAt,
        parsed,
      );
    }

    const targetRuns:
      RunRecord[] = [];

    for (
      let caseIndex = 0;
      caseIndex <
      activeCases.length;
      caseIndex += 1
    ) {
      const benchmarkCase =
        activeCases[
          caseIndex
        ];

      const source =
        sources[
          caseIndex
        ];

      const isTarget =
        benchmarkCase.id ===
        config.targetCaseId;

      for (
        let run = 1;
        run <=
        config.runsPerCase;
        run += 1
      ) {
        const startedAt =
          performance.now();

        try {
          const outcome =
            await withTimeout(
              remove(
                source,
                benchmarkCase.id,
                strategy,
              ),
              config.timeoutMs,
              `${strategy} ${benchmarkCase.id} run ${run}`,
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
              `${strategy} ${benchmarkCase.id} run ${run} did not reuse the primed session.`,
            );
          }

          if (
            isTarget
          ) {
            await uploadOutput(
              strategy,
              run,
              outcome.result.blob,
            );

            const record:
              RunRecord = {
                schemaVersion: 1,
                strategy,
                caseId:
                  benchmarkCase.id,
                run,
                timings:
                  outcome.result
                    .timings,
              };

            targetRuns.push(
              record,
            );

            await postJson(
              "/run",
              record,
            );
          }

          writeStatus(
            `${strategy} ${benchmarkCase.id} run ${run}: ${outcome.result.timings.totalMs.toFixed(
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
            strategy,
            benchmarkCase.id,
            run,
            startedAt,
            parsed,
          );
        }
      }
    }

    const report:
      StrategyReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        userAgent:
          navigator.userAgent,
        strategy,
        targetCaseId:
          config.targetCaseId,
        runsPerCase:
          config.runsPerCase,
        runs:
          targetRuns,
      };

    const response =
      await fetch(
        "/strategy-report",
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
        "Source-snapshot benchmark passed.",
      );

      return;
    }

    if (
      completion.nextStrategy ===
      undefined
    ) {
      throw new Error(
        "Source-snapshot server did not return the next strategy.",
      );
    }

    globalThis.location.replace(
      `/?strategy=${encodeURIComponent(
        completion.nextStrategy,
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
      "SOURCE-SNAPSHOT BENCHMARK FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
