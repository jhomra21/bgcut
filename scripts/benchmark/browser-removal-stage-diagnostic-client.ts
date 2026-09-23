import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import { removeBackgroundWebGpuWithStrategy } from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

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
});

type RunRecord = {
  readonly schemaVersion: 1;
  readonly caseId: string;
  readonly run: number;
  readonly width: number;
  readonly height: number;
  readonly timings: RemovalTimings;
};

type FailureRecord = {
  readonly schemaVersion: 1;
  readonly caseId: string;
  readonly run:
    | number
    | "prime";
  readonly elapsedMs: number;
  readonly message: string;
  readonly stack: string;
};

type RequestBody =
  | RunRecord
  | FailureRecord;

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (
  status === null
) {
  throw new Error(
    "Removal-stage diagnostic status element is missing.",
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

const uploadBytes = async (
  path: string,
  bytes:
    | Blob
    | Uint8Array
    | Uint8ClampedArray,
): Promise<void> => {
  const response =
    await fetch(
      path,
      {
        method: "POST",
        body: bytes,
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

const decodePngRgba = async (
  blob: Blob,
): Promise<Uint8ClampedArray> => {
  const bitmap =
    await createImageBitmap(
      blob,
    );

  try {
    const canvas =
      document.createElement(
        "canvas",
      );

    canvas.width =
      bitmap.width;

    canvas.height =
      bitmap.height;

    const context =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        },
      );

    if (
      context === null
    ) {
      throw new Error(
        "2D canvas is unavailable for PNG round-trip diagnostics.",
      );
    }

    context.drawImage(
      bitmap,
      0,
      0,
    );

    return new Uint8ClampedArray(
      context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data,
    );
  } finally {
    bitmap.close();
  }
};

const remove = async (
  source: Blob,
  caseId: string,
  collectDiagnostics: boolean,
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
      collectDiagnostics,
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

const recordFailure = async (
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
        `Could not load removal-stage diagnostic config: HTTP ${configResponse.status}.`,
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
        "Removal-stage diagnostic must run on Safari's no-capture path.",
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
        `Target case ${config.targetCaseId} is not in the manifest.`,
      );
    }

    const sources =
      await Promise.all(
        config.cases
          .slice(
            0,
            targetIndex + 1,
          )
          .map(
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

    const primeCase =
      config.cases[0];

    const primeStartedAt =
      performance.now();

    try {
      const prime =
        await withTimeout(
          remove(
            sources[0],
            primeCase.id,
            false,
          ),
          config.timeoutMs,
          `prime ${primeCase.id}`,
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
        `prime ${primeCase.id}: ${prime.result.timings.totalMs.toFixed(
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
        primeCase.id,
        "prime",
        primeStartedAt,
        parsed,
      );
    }

    for (
      let caseIndex = 0;
      caseIndex <=
      targetIndex;
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
                isTarget,
              ),
              config.timeoutMs,
              `${benchmarkCase.id} run ${run}`,
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
              `${benchmarkCase.id} run ${run} did not reuse the primed session.`,
            );
          }

          if (
            isTarget
          ) {
            const diagnostics =
              outcome.result
                .diagnostics;

            if (
              diagnostics ===
              undefined
            ) {
              throw new Error(
                "Target run did not return stage diagnostics.",
              );
            }

            const exportedRgba =
              await decodePngRgba(
                outcome.result.blob,
              );

            await Promise.all([
              uploadBytes(
                `/artifact/${run}/matte`,
                diagnostics
                  .matteRgba,
              ),
              uploadBytes(
                `/artifact/${run}/composite`,
                diagnostics
                  .compositeRgba,
              ),
              uploadBytes(
                `/artifact/${run}/exported-rgba`,
                exportedRgba,
              ),
              uploadBytes(
                `/artifact/${run}/output-png`,
                outcome.result.blob,
              ),
            ]);

            const record:
              RunRecord = {
                schemaVersion: 1,
                caseId:
                  benchmarkCase.id,
                run,
                width:
                  outcome.result.width,
                height:
                  outcome.result.height,
                timings:
                  outcome.result
                    .timings,
              };

            await postJson(
              "/run",
              record,
            );
          }

          writeStatus(
            `${benchmarkCase.id} run ${run}: ${outcome.result.timings.totalMs.toFixed(
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
            benchmarkCase.id,
            run,
            startedAt,
            parsed,
          );
        }
      }
    }

    const finalize =
      await fetch(
        "/finalize",
        {
          method: "POST",
        },
      );

    if (
      !finalize.ok
    ) {
      throw new Error(
        await finalize.text(),
      );
    }

    writeStatus("");
    writeStatus(
      "Removal-stage diagnostic passed.",
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
      "REMOVAL-STAGE DIAGNOSTIC FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
