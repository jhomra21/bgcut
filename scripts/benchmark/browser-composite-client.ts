import { Schema } from "effect";

import { removeBrowserBackground } from "../../src/browser/actions";
import type { RemovalTimings } from "../../src/browser/timing";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
});

const BenchmarkConfigSchema = Schema.Struct({
  warmRepeats: Schema.Number,
  cases: Schema.Array(BenchmarkCaseSchema),
});

type CompositeMode = "cpu" | "gpu";

type RunResult = {
  readonly blob: Blob;
  readonly timings: RemovalTimings;
};

type ModeReport = {
  readonly firstRun: RemovalTimings;
  readonly warmRuns: readonly RemovalTimings[];
};

type CaseReport = {
  readonly id: string;
  readonly gpu: ModeReport;
  readonly cpu: ModeReport;
  readonly postGpuCpuSentinel: RemovalTimings;
};

const status = document.querySelector<HTMLPreElement>("#status");

if (status === null) {
  throw new Error("Benchmark status element is missing.");
}

const writeStatus = (message: string): void => {
  status.textContent += `${message}\n`;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const setMode = (mode: CompositeMode): void => {
  const url = new URL(globalThis.location.href);

  url.searchParams.set("engine", "webgpu");
  url.searchParams.set("composite", mode);
  globalThis.history.replaceState(null, "", url);
};

const runMode = async (
  mode: CompositeMode,
  source: Blob,
  id: string,
): Promise<RunResult> => {
  setMode(mode);

  const file = new File(
    [source],
    `${id}.png`,
    {
      type: source.type || "image/png",
    },
  );

  const outcome = await removeBrowserBackground(file);

  if (!outcome.ok) {
    throw new Error(
      `${mode} composite failed for ${id}: ${outcome.message}`,
    );
  }

  return {
    blob: outcome.result.blob,
    timings: outcome.result.timings,
  };
};

const uploadOutput = async (
  mode: CompositeMode,
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
    throw new Error(
      `Could not save ${mode} output ${caseIndex}: HTTP ${response.status}.`,
    );
  }
};

const main = async (): Promise<void> => {
  const configResponse = await fetch("/config.json");

  if (!configResponse.ok) {
    throw new Error(
      `Could not load benchmark config: HTTP ${configResponse.status}.`,
    );
  }

  const config = Schema.decodeUnknownSync(BenchmarkConfigSchema)(
    await configResponse.json(),
  );

  const cases: CaseReport[] = [];

  for (
    let caseIndex = 0;
    caseIndex < config.cases.length;
    caseIndex += 1
  ) {
    const benchmarkCase = config.cases[caseIndex];

    writeStatus(`Running ${benchmarkCase.id}.`);

    const inputResponse = await fetch(
      benchmarkCase.inputUrl,
      { cache: "no-store" },
    );

    if (!inputResponse.ok) {
      throw new Error(
        `Input ${benchmarkCase.id} failed with HTTP ${inputResponse.status}.`,
      );
    }

    const source = await inputResponse.blob();

    const cpuFirst = await runMode(
      "cpu",
      source,
      benchmarkCase.id,
    );

    await uploadOutput("cpu", caseIndex, cpuFirst.blob);

    const gpuFirst = await runMode(
      "gpu",
      source,
      benchmarkCase.id,
    );

    await uploadOutput("gpu", caseIndex, gpuFirst.blob);

    const postGpuCpuSentinel = await runMode(
      "cpu",
      source,
      benchmarkCase.id,
    );

    const gpuWarmRuns: RemovalTimings[] = [];
    const cpuWarmRuns: RemovalTimings[] = [];

    for (let run = 0; run < config.warmRepeats; run += 1) {
      const order: readonly CompositeMode[] =
        run % 2 === 0
          ? ["cpu", "gpu"]
          : ["gpu", "cpu"];

      for (const mode of order) {
        const result = await runMode(
          mode,
          source,
          benchmarkCase.id,
        );

        if (mode === "gpu") {
          gpuWarmRuns.push(result.timings);
        } else {
          cpuWarmRuns.push(result.timings);
        }
      }
    }

    const gpuWarmMedianMs = median(
      gpuWarmRuns.map((run) => run.totalMs),
    );

    const cpuWarmMedianMs = median(
      cpuWarmRuns.map((run) => run.totalMs),
    );

    writeStatus(
      `${benchmarkCase.id}: GPU ${gpuWarmMedianMs.toFixed(1)} ms, CPU control ${cpuWarmMedianMs.toFixed(1)} ms.`,
    );

    cases.push({
      id: benchmarkCase.id,
      gpu: {
        firstRun: gpuFirst.timings,
        warmRuns: gpuWarmRuns,
      } satisfies ModeReport,
      cpu: {
        firstRun: cpuFirst.timings,
        warmRuns: cpuWarmRuns,
      } satisfies ModeReport,
      postGpuCpuSentinel: postGpuCpuSentinel.timings,
    });
  }

  const gpuCaseMedians = cases.map((benchmarkCase) =>
    median(
      benchmarkCase.gpu.warmRuns.map(
        (run) => run.totalMs,
      ),
    )
  );

  const cpuCaseMedians = cases.map((benchmarkCase) =>
    median(
      benchmarkCase.cpu.warmRuns.map(
        (run) => run.totalMs,
      ),
    )
  );

  const report = {
    schemaVersion: 1,
    tool: "bgcut-browser-composite",
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    warmRepeats: config.warmRepeats,
    cases,
    summary: {
      gpuWarmMedianAcrossCaseMediansMs:
        median(gpuCaseMedians),
      cpuWarmMedianAcrossCaseMediansMs:
        median(cpuCaseMedians),
    },
  };

  const response = await fetch("/report", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(report),
  });

  const result = await response.text();

  if (!response.ok) {
    throw new Error(result);
  }

  writeStatus("");
  writeStatus("Benchmark complete.");
  writeStatus(result);
};

void main().catch((error) => {
  const parsed =
    error instanceof Error
      ? error
      : new Error(String(error));

  const message =
    `${parsed.message}\n${parsed.stack ?? ""}`;

  writeStatus("");
  writeStatus("BENCHMARK FAILED");
  writeStatus(message);

  void fetch("/failure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
});
