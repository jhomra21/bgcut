import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import {
  removeBackgroundWebGpuWithStrategy,
  type WebGpuOutputLocation,
} from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
});

const ConfigSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
  warmRunsPerMode: Schema.Number,
});

type RunRecord = {
  readonly mode: WebGpuOutputLocation;
  readonly caseId: string;
  readonly run: number;
  readonly timings: RemovalTimings;
};

type StageSummary = {
  readonly totalMs: number;
  readonly inferenceMs: number;
  readonly outputReadbackMs: number;
  readonly matteMs: number;
  readonly compositeMs: number;
  readonly exportMs: number;
};

type CaseReport = {
  readonly id: string;
  readonly gpuBuffer: readonly RunRecord[];
  readonly cpu: readonly RunRecord[];
};

const status = document.querySelector<HTMLPreElement>("#status");

if (status === null) {
  throw new Error("Output-location benchmark status element is missing.");
}

const writeStatus = (message: string): void => {
  status.textContent += `${message}\n`;
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    throw new Error("Median requires at least one value.");
  }

  const sorted = [...values].sort(
    (left, right) => left - right,
  );

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (
        sorted[middle - 1] +
        sorted[middle]
      ) / 2;
};

const summarize = (
  records: readonly RunRecord[],
): StageSummary => ({
  totalMs: median(
    records.map((record) => record.timings.totalMs),
  ),
  inferenceMs: median(
    records.map((record) => record.timings.inferenceMs),
  ),
  outputReadbackMs: median(
    records.map(
      (record) =>
        record.timings.outputReadbackMs,
    ),
  ),
  matteMs: median(
    records.map((record) => record.timings.matteMs),
  ),
  compositeMs: median(
    records.map((record) => record.timings.compositeMs),
  ),
  exportMs: median(
    records.map((record) => record.timings.exportMs),
  ),
});

const runMode = async (
  mode: WebGpuOutputLocation,
  source: Blob,
  id: string,
) =>
  Effect.runPromise(
    removeBackgroundWebGpuWithStrategy(
      new File(
        [source],
        `${id}.png`,
        {
          type: source.type || "image/png",
        },
      ),
      "no-capture-reuse",
      mode,
    ).pipe(
      Effect.match({
        onFailure: (error) => ({
          ok: false as const,
          message:
            formatBackgroundRemovalError(error),
        }),
        onSuccess: (result) => ({
          ok: true as const,
          result,
        }),
      }),
    ),
  );

const uploadOutput = async (
  mode: WebGpuOutputLocation,
  caseIndex: number,
  blob: Blob,
): Promise<void> => {
  const response = await fetch(
    `/output/${mode}/${caseIndex}`,
    {
      method: "POST",
      body: blob,
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }
};

const runMeasuredMode = async (
  mode: WebGpuOutputLocation,
  source: Blob,
  caseId: string,
  caseIndex: number,
  warmRuns: number,
): Promise<readonly RunRecord[]> => {
  writeStatus(
    `${caseId}: priming ${mode} output.`,
  );

  const prime = await runMode(
    mode,
    source,
    caseId,
  );

  if (!prime.ok) {
    throw new Error(
      `${caseId} ${mode} prime failed: ${prime.message}`,
    );
  }

  const records: RunRecord[] = [];

  for (
    let runIndex = 0;
    runIndex < warmRuns;
    runIndex += 1
  ) {
    const outcome = await runMode(
      mode,
      source,
      caseId,
    );

    if (!outcome.ok) {
      throw new Error(
        `${caseId} ${mode} run ${runIndex + 1} failed: ${outcome.message}`,
      );
    }

    if (!outcome.result.timings.sessionReused) {
      throw new Error(
        `${caseId} ${mode} run ${runIndex + 1} did not reuse the primed no-capture session.`,
      );
    }

    if (runIndex === 0) {
      await uploadOutput(
        mode,
        caseIndex,
        outcome.result.blob,
      );
    }

    records.push({
      mode,
      caseId,
      run: runIndex + 1,
      timings: outcome.result.timings,
    });
  }

  const summary = summarize(records);

  writeStatus(
    `${caseId}: ${mode} warm median ${summary.totalMs.toFixed(1)} ms.`,
  );

  return records;
};

const main = async (): Promise<void> => {
  const configResponse =
    await fetch("/config.json");

  if (!configResponse.ok) {
    throw new Error(
      `Could not load output-location config: HTTP ${configResponse.status}.`,
    );
  }

  const config = Schema.decodeUnknownSync(
    ConfigSchema,
  )(
    await configResponse.json(),
  );

  if (
    resolveDefaultWebGpuSessionStrategy(
      navigator.userAgent,
    ) !== "no-capture-reuse"
  ) {
    throw new Error(
      "Output-location benchmark must run on the Safari no-capture path.",
    );
  }

  const cases: CaseReport[] = [];

  for (
    let caseIndex = 0;
    caseIndex < config.cases.length;
    caseIndex += 1
  ) {
    const benchmarkCase =
      config.cases[caseIndex];

    const inputResponse = await fetch(
      benchmarkCase.inputUrl,
      { cache: "no-store" },
    );

    if (!inputResponse.ok) {
      throw new Error(
        `Could not load ${benchmarkCase.id}: HTTP ${inputResponse.status}.`,
      );
    }

    const source = await inputResponse.blob();

    const order: readonly WebGpuOutputLocation[] =
      caseIndex % 2 === 0
        ? ["gpu-buffer", "cpu"]
        : ["cpu", "gpu-buffer"];

    let gpuBuffer:
      | readonly RunRecord[]
      | undefined;
    let cpu:
      | readonly RunRecord[]
      | undefined;

    for (const mode of order) {
      const records = await runMeasuredMode(
        mode,
        source,
        benchmarkCase.id,
        caseIndex,
        config.warmRunsPerMode,
      );

      if (mode === "gpu-buffer") {
        gpuBuffer = records;
      } else {
        cpu = records;
      }
    }

    if (
      gpuBuffer === undefined ||
      cpu === undefined
    ) {
      throw new Error(
        `Incomplete output-location records for ${benchmarkCase.id}.`,
      );
    }

    cases.push({
      id: benchmarkCase.id,
      gpuBuffer,
      cpu,
    });
  }

  const gpuCaseSummaries = cases.map(
    (benchmarkCase) =>
      summarize(benchmarkCase.gpuBuffer),
  );

  const cpuCaseSummaries = cases.map(
    (benchmarkCase) =>
      summarize(benchmarkCase.cpu),
  );

  const aggregateStage = (
    summaries: readonly StageSummary[],
    key: keyof StageSummary,
  ): number =>
    median(
      summaries.map(
        (summary) => summary[key],
      ),
    );

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    strategy: "no-capture-reuse" as const,
    warmRunsPerMode:
      config.warmRunsPerMode,
    cases,
    summary: {
      gpuBuffer: {
        totalMs: aggregateStage(
          gpuCaseSummaries,
          "totalMs",
        ),
        inferenceMs: aggregateStage(
          gpuCaseSummaries,
          "inferenceMs",
        ),
        outputReadbackMs:
          aggregateStage(
            gpuCaseSummaries,
            "outputReadbackMs",
          ),
        matteMs: aggregateStage(
          gpuCaseSummaries,
          "matteMs",
        ),
        compositeMs: aggregateStage(
          gpuCaseSummaries,
          "compositeMs",
        ),
        exportMs: aggregateStage(
          gpuCaseSummaries,
          "exportMs",
        ),
      },
      cpu: {
        totalMs: aggregateStage(
          cpuCaseSummaries,
          "totalMs",
        ),
        inferenceMs: aggregateStage(
          cpuCaseSummaries,
          "inferenceMs",
        ),
        outputReadbackMs:
          aggregateStage(
            cpuCaseSummaries,
            "outputReadbackMs",
          ),
        matteMs: aggregateStage(
          cpuCaseSummaries,
          "matteMs",
        ),
        compositeMs: aggregateStage(
          cpuCaseSummaries,
          "compositeMs",
        ),
        exportMs: aggregateStage(
          cpuCaseSummaries,
          "exportMs",
        ),
      },
    },
  };

  const response = await fetch(
    "/report",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(report),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  writeStatus("");
  writeStatus(
    "Safari output-location benchmark passed.",
  );
};

void main().catch((error) => {
  const parsed =
    error instanceof Error
      ? error
      : new Error(String(error));

  const message =
    `${parsed.message}\n${parsed.stack ?? ""}`;

  writeStatus("");
  writeStatus(
    "SAFARI OUTPUT-LOCATION BENCHMARK FAILED",
  );
  writeStatus(message);

  void fetch(
    "/failure",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ message }),
    },
  );
});
