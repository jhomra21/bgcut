import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import { removeBackgroundWebGpuWithStrategy } from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const ModeSchema = Schema.Literal(
  "fp32",
  "fp16",
);

const SequenceSchema = Schema.Literal(
  "fp32-first",
  "fp16-first",
);

const DirectionSchema = Schema.Literal(
  "forward",
  "reverse",
);

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
});

const BlockSchema = Schema.Struct({
  index: Schema.Number,
  sequence: SequenceSchema,
  direction: DirectionSchema,
  mode: ModeSchema,
  modelPath: Schema.String,
  caseIndexes: Schema.Array(
    Schema.Number,
  ),
});

const ConfigSchema = Schema.Struct({
  cases: Schema.Array(
    BenchmarkCaseSchema,
  ),
  runsPerCase: Schema.Number,
  timeoutMs: Schema.Number,
  blocks: Schema.Array(
    BlockSchema,
  ),
});

const CompletionSchema = Schema.Struct({
  done: Schema.Boolean,
});

type Mode =
  Schema.Schema.Type<
    typeof ModeSchema
  >;

type Sequence =
  Schema.Schema.Type<
    typeof SequenceSchema
  >;

type Direction =
  Schema.Schema.Type<
    typeof DirectionSchema
  >;

type Block =
  Schema.Schema.Type<
    typeof BlockSchema
  >;

type RunRecord = {
  readonly schemaVersion: 1;
  readonly blockIndex: number;
  readonly sequence: Sequence;
  readonly direction: Direction;
  readonly mode: Mode;
  readonly caseId: string;
  readonly run: number;
  readonly timings: RemovalTimings;
};

type PrimeRecord = {
  readonly schemaVersion: 1;
  readonly blockIndex: number;
  readonly sequence: Sequence;
  readonly direction: Direction;
  readonly mode: Mode;
  readonly caseId: string;
  readonly timings: RemovalTimings;
};

type FailureRecord = {
  readonly schemaVersion: 1;
  readonly blockIndex: number;
  readonly sequence: Sequence;
  readonly direction: Direction;
  readonly mode: Mode;
  readonly caseId: string;
  readonly run:
    | number
    | "prime";
  readonly elapsedMs: number;
  readonly message: string;
  readonly stack: string;
};

type BlockReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly block: Block;
  readonly prime: PrimeRecord;
  readonly runs: readonly RunRecord[];
};

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (
  status === null
) {
  throw new Error(
    "FP16 six-image status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
};

const queryFlag = (
  name: string,
): boolean =>
  new URL(
    globalThis.location.href,
  ).searchParams.get(
    name,
  ) === "1";

const sessionTokenFromLocation =
  (): string => {
    const match =
      globalThis.location.pathname.match(
        /^\/session\/([^/]+)$/u,
      );

    if (
      match === null
    ) {
      throw new Error(
        "FP16 six-image benchmark is not running from an authorized session URL.",
      );
    }

    return decodeURIComponent(
      match[1],
    );
  };

const launchTokenFromLocation =
  (): string => {
    const value =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "launch",
      );

    if (
      value === null ||
      value.length === 0
    ) {
      throw new Error(
        "FP16 six-image benchmark launch token is missing.",
      );
    }

    return value;
  };

const blockIndexFromLocation =
  (): number => {
    const raw =
      new URL(
        globalThis.location.href,
      ).searchParams.get(
        "block",
      );

    const value =
      Number.parseInt(
        raw ?? "0",
        10,
      );

    if (
      !Number.isInteger(
        value,
      ) ||
      value < 0
    ) {
      throw new Error(
        `Invalid FP16 six-image block "${raw}".`,
      );
    }

    return value;
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
  modelPath: string,
) =>
  Effect.runPromise(
    removeBackgroundWebGpuWithStrategy(
      makeFile(
        source,
        caseId,
      ),
      "no-capture-reuse",
      modelPath,
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
    | FailureRecord
    | BlockReport,
  sessionToken: string,
  launchToken: string,
): Promise<Response> => {
  const response =
    await fetch(
      path,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-bgcut-benchmark-session":
            sessionToken,
          "x-bgcut-benchmark-launch":
            launchToken,
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

  return response;
};

const uploadOutput = async (
  blockIndex: number,
  caseIndex: number,
  run: number,
  blob: Blob,
  sessionToken: string,
  launchToken: string,
): Promise<void> => {
  const response =
    await fetch(
      `/output/${blockIndex}/${caseIndex}/${run}`,
      {
        method: "POST",
        headers: {
          "x-bgcut-benchmark-session":
            sessionToken,
          "x-bgcut-benchmark-launch":
            launchToken,
        },
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

const loadSource = async (
  inputUrl: string,
  caseId: string,
): Promise<Blob> => {
  const response =
    await fetch(
      inputUrl,
      {
        cache:
          "no-store",
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Could not load ${caseId}: HTTP ${response.status}.`,
    );
  }

  return response.blob();
};

const recordFailure = async (
  block: Block,
  caseId: string,
  run:
    | number
    | "prime",
  startedAt: number,
  error: Error,
  sessionToken: string,
  launchToken: string,
): Promise<never> => {
  const failure:
    FailureRecord = {
      schemaVersion: 1,
      blockIndex:
        block.index,
      sequence:
        block.sequence,
      direction:
        block.direction,
      mode:
        block.mode,
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
    sessionToken,
    launchToken,
  );

  throw error;
};

const main =
  async (): Promise<void> => {
    const sessionToken =
      sessionTokenFromLocation();

    const launchToken =
      launchTokenFromLocation();

    const blockIndex =
      blockIndexFromLocation();

    const configResponse =
      await fetch(
        `/config.json?session=${encodeURIComponent(
          sessionToken,
        )}&launch=${encodeURIComponent(
          launchToken,
        )}&block=${blockIndex}`,
        {
          cache:
            "no-store",
        },
      );

    if (
      !configResponse.ok
    ) {
      throw new Error(
        `Could not load FP16 six-image config: HTTP ${configResponse.status}.`,
      );
    }

    const config =
      Schema.decodeUnknownSync(
        ConfigSchema,
      )(
        await configResponse.json(),
      );

    const block =
      config.blocks.find(
        (candidate) =>
          candidate.index ===
          blockIndex,
      );

    if (
      block === undefined
    ) {
      throw new Error(
        `FP16 six-image block ${blockIndex} is not configured.`,
      );
    }

    if (
      resolveDefaultWebGpuSessionStrategy(
        navigator.userAgent,
      ) !==
      "no-capture-reuse"
    ) {
      throw new Error(
        "FP16 six-image benchmark must run on Safari's no-capture path.",
      );
    }

    const primeCaseIndex =
      block.caseIndexes.at(
        0,
      );

    if (
      primeCaseIndex ===
      undefined
    ) {
      throw new Error(
        `Block ${block.index} has no benchmark cases.`,
      );
    }

    const primeCase =
      config.cases.at(
        primeCaseIndex,
      );

    if (
      primeCase ===
      undefined
    ) {
      throw new Error(
        `Block ${block.index} references unknown prime case ${primeCaseIndex}.`,
      );
    }

    writeStatus(
      `Block ${block.index + 1}/${config.blocks.length}: ${block.sequence}, ${block.mode}, ${block.direction}.`,
    );

    const primeSource =
      await loadSource(
        primeCase.inputUrl,
        primeCase.id,
      );

    const primeStartedAt =
      performance.now();

    let primeRecord:
      | PrimeRecord
      | undefined;

    try {
      const prime =
        await withTimeout(
          remove(
            primeSource,
            primeCase.id,
            block.modelPath,
          ),
          config.timeoutMs,
          `${block.mode} prime`,
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
          `Block ${block.index} prime unexpectedly reused a session.`,
        );
      }

      primeRecord = {
        schemaVersion: 1,
        blockIndex:
          block.index,
        sequence:
          block.sequence,
        direction:
          block.direction,
        mode:
          block.mode,
        caseId:
          primeCase.id,
        timings:
          prime.result.timings,
      };

      await postJson(
        "/prime",
        primeRecord,
        sessionToken,
        launchToken,
      );

      writeStatus(
        `${block.mode} prime: ${primeRecord.timings.totalMs.toFixed(
          1,
        )} ms.`,
      );

      if (
        queryFlag(
          "primeOnly",
        )
      ) {
        writeStatus(
          "Prime-only prewarm complete.",
        );

        return;
      }
    } catch (error) {
      const parsed =
        error instanceof Error
          ? error
          : new Error(
              String(error),
            );

      await recordFailure(
        block,
        primeCase.id,
        "prime",
        primeStartedAt,
        parsed,
        sessionToken,
        launchToken,
      );
    }

    if (
      primeRecord ===
      undefined
    ) {
      throw new Error(
        "FP16 six-image prime did not produce a record.",
      );
    }

    const records:
      RunRecord[] = [];

    for (
      const caseIndex of
      block.caseIndexes
    ) {
      const benchmarkCase =
        config.cases.at(
          caseIndex,
        );

      if (
        benchmarkCase ===
        undefined
      ) {
        throw new Error(
          `Block ${block.index} references unknown case ${caseIndex}.`,
        );
      }

      const source =
        caseIndex ===
          primeCaseIndex
          ? primeSource
          : await loadSource(
              benchmarkCase.inputUrl,
              benchmarkCase.id,
            );

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
                block.modelPath,
              ),
              config.timeoutMs,
              `${block.mode} ${benchmarkCase.id} run ${run}`,
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
              `Block ${block.index} ${benchmarkCase.id} run ${run} did not reuse the primed session.`,
            );
          }

          await uploadOutput(
            block.index,
            caseIndex,
            run,
            outcome.result.blob,
            sessionToken,
            launchToken,
          );

          const record:
            RunRecord = {
              schemaVersion: 1,
              blockIndex:
                block.index,
              sequence:
                block.sequence,
              direction:
                block.direction,
              mode:
                block.mode,
              caseId:
                benchmarkCase.id,
              run,
              timings:
                outcome.result
                  .timings,
            };

          records.push(
            record,
          );

          await postJson(
            "/run",
            record,
            sessionToken,
            launchToken,
          );

          writeStatus(
            `${benchmarkCase.id} run ${run}: inference ${record.timings.inferenceMs.toFixed(
              1,
            )} ms, total ${record.timings.totalMs.toFixed(
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
            block,
            benchmarkCase.id,
            run,
            startedAt,
            parsed,
            sessionToken,
            launchToken,
          );
        }
      }
    }

    const report:
      BlockReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        userAgent:
          navigator.userAgent,
        block,
        prime:
          primeRecord,
        runs:
          records,
      };

    const response =
      await postJson(
        "/block-report",
        report,
        sessionToken,
        launchToken,
      );

    const completion =
      Schema.decodeUnknownSync(
        CompletionSchema,
      )(
        await response.json(),
      );

    writeStatus("");

    writeStatus(
      completion.done
        ? "FP16 six-image benchmark complete."
        : "Isolated block complete.",
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
      "FP16 SIX-IMAGE BENCHMARK FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
