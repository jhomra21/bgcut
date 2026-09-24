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

const BlockSchema = Schema.Struct({
  index: Schema.Number,
  sequence: SequenceSchema,
  mode: ModeSchema,
  modelPath: Schema.String,
});

const ConfigSchema = Schema.Struct({
  caseId: Schema.String,
  inputUrl: Schema.String,
  runs: Schema.Number,
  timeoutMs: Schema.Number,
  blocks: Schema.Array(
    BlockSchema,
  ),
});

const CompletionSchema = Schema.Struct({
  done: Schema.Boolean,
  nextBlock: Schema.optional(
    Schema.Number,
  ),
});

type Mode =
  Schema.Schema.Type<
    typeof ModeSchema
  >;

type Sequence =
  Schema.Schema.Type<
    typeof SequenceSchema
  >;

type Block =
  Schema.Schema.Type<
    typeof BlockSchema
  >;

type RunRecord = {
  readonly schemaVersion: 1;
  readonly blockIndex: number;
  readonly sequence: Sequence;
  readonly mode: Mode;
  readonly run: number;
  readonly timings: RemovalTimings;
};

type PrimeRecord = {
  readonly schemaVersion: 1;
  readonly blockIndex: number;
  readonly sequence: Sequence;
  readonly mode: Mode;
  readonly timings: RemovalTimings;
};

type FailureRecord = {
  readonly schemaVersion: 1;
  readonly blockIndex: number;
  readonly sequence: Sequence;
  readonly mode: Mode;
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
  readonly caseId: string;
  readonly block: Block;
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
    "FP16 benchmark status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
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
        `Invalid FP16 benchmark block "${raw}".`,
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

const remove = async (
  source: Blob,
  caseId: string,
  modelPath: string,
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
): Promise<Response> => {
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

  return response;
};

const uploadOutput = async (
  blockIndex: number,
  run: number,
  blob: Blob,
): Promise<void> => {
  const response =
    await fetch(
      `/output/${blockIndex}/${run}`,
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
  block: Block,
  run:
    | number
    | "prime",
  startedAt: number,
  error: Error,
): Promise<never> => {
  const failure:
    FailureRecord = {
      schemaVersion: 1,
      blockIndex:
        block.index,
      sequence:
        block.sequence,
      mode:
        block.mode,
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
        {
          cache:
            "no-store",
        },
      );

    if (
      !configResponse.ok
    ) {
      throw new Error(
        `Could not load FP16 benchmark config: HTTP ${configResponse.status}.`,
      );
    }

    const config =
      Schema.decodeUnknownSync(
        ConfigSchema,
      )(
        await configResponse.json(),
      );

    const blockIndex =
      blockIndexFromLocation();

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
        `FP16 benchmark block ${blockIndex} is not configured.`,
      );
    }

    if (
      resolveDefaultWebGpuSessionStrategy(
        navigator.userAgent,
      ) !==
      "no-capture-reuse"
    ) {
      throw new Error(
        "FP16 benchmark must run on Safari's no-capture path.",
      );
    }

    writeStatus(
      `Block ${block.index + 1}/${config.blocks.length}: ${block.sequence}, ${block.mode}.`,
    );

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
        mode:
          block.mode,
        timings:
          prime.result.timings,
      };

      await postJson(
        "/prime",
        primeRecord,
      );

      writeStatus(
        `${block.mode} prime: ${primeRecord.timings.totalMs.toFixed(
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
        "FP16 benchmark prime did not produce a record.",
      );
    }

    const records:
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
              block.modelPath,
            ),
            config.timeoutMs,
            `${block.mode} run ${run}`,
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
            `Block ${block.index} ${block.mode} run ${run} did not reuse the primed session.`,
          );
        }

        await uploadOutput(
          block.index,
          run,
          outcome.result.blob,
        );

        const record:
          RunRecord = {
            schemaVersion: 1,
            blockIndex:
              block.index,
            sequence:
              block.sequence,
            mode:
              block.mode,
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
        );

        writeStatus(
          `${block.mode} run ${run}: inference ${record.timings.inferenceMs.toFixed(
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
          run,
          startedAt,
          parsed,
        );
      }
    }

    const report:
      BlockReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        userAgent:
          navigator.userAgent,
        caseId:
          config.caseId,
        block,
        runs:
          records,
        prime:
          primeRecord,
      };

    const response =
      await postJson(
        "/block-report",
        report,
      );

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
        "FP16 model benchmark complete.",
      );

      return;
    }

    if (
      completion.nextBlock ===
      undefined
    ) {
      throw new Error(
        "FP16 benchmark server did not return the next block.",
      );
    }

    globalThis.location.replace(
      `/?block=${completion.nextBlock}`,
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
      "FP16 MODEL BENCHMARK FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
