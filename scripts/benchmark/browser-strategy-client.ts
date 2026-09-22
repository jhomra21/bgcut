import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import {
  removeBackgroundWebGpu,
  removeBackgroundWebGpuWithStrategy,
  type BrowserInferenceEngine,
} from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";
import {
  resolveDefaultWebGpuSessionStrategy,
  type WebGpuSessionStrategy,
} from "../../src/browser/webgpu-session-strategy";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
});

const ConfigSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
  runsPerCase: Schema.Number,
});

type ValidationMode =
  | "production-default"
  | "capture-reference";

type ValidationRunRecord = {
  readonly schemaVersion: 1;
  readonly mode: ValidationMode;
  readonly caseId: string;
  readonly run: number;
  readonly engine: BrowserInferenceEngine;
  readonly timings: RemovalTimings;
};

type ValidationReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly defaultStrategy: WebGpuSessionStrategy;
  readonly runsPerCase: number;
  readonly productionRuns: readonly ValidationRunRecord[];
  readonly captureReferenceRuns: readonly ValidationRunRecord[];
  readonly summary: {
    readonly productionWarmMedianMs: number;
    readonly captureReferenceMedianMs: number;
  };
};

const status = document.querySelector<HTMLPreElement>("#status");

if (status === null) {
  throw new Error("Safari validation status element is missing.");
}

const writeStatus = (message: string): void => {
  status.textContent += `${message}\n`;
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    throw new Error("Median requires at least one value.");
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const removeProductionDefault = async (file: File) =>
  Effect.runPromise(
    removeBackgroundWebGpu(file).pipe(
      Effect.match({
        onFailure: (error) => ({
          ok: false as const,
          message: formatBackgroundRemovalError(error),
        }),
        onSuccess: (result) => ({
          ok: true as const,
          result,
        }),
      }),
    ),
  );

const removeCaptureReference = async (file: File) =>
  Effect.runPromise(
    removeBackgroundWebGpuWithStrategy(
      file,
      "capture-recreate",
    ).pipe(
      Effect.match({
        onFailure: (error) => ({
          ok: false as const,
          message: formatBackgroundRemovalError(error),
        }),
        onSuccess: (result) => ({
          ok: true as const,
          result,
        }),
      }),
    ),
  );

const uploadOutput = async (
  mode: ValidationMode,
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

const uploadRun = async (
  mode: ValidationMode,
  caseIndex: number,
  runIndex: number,
  record: ValidationRunRecord,
): Promise<void> => {
  const response = await fetch(
    `/run/${mode}/${caseIndex}/${runIndex}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(record),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
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
      type: source.type || "image/png",
    },
  );

const main = async (): Promise<void> => {
  const configResponse = await fetch("/config.json");

  if (!configResponse.ok) {
    throw new Error(
      `Could not load Safari validation config: HTTP ${configResponse.status}.`,
    );
  }

  const config = Schema.decodeUnknownSync(ConfigSchema)(
    await configResponse.json(),
  );
  const defaultStrategy =
    resolveDefaultWebGpuSessionStrategy(
      navigator.userAgent,
    );

  if (defaultStrategy !== "no-capture-reuse") {
    throw new Error(
      `Safari validation expected no-capture-reuse, resolved ${defaultStrategy} for ${navigator.userAgent}.`,
    );
  }

  const productionRuns: ValidationRunRecord[] = [];
  const captureReferenceRuns: ValidationRunRecord[] = [];

  writeStatus("Production Safari path: no-capture-reuse.");

  for (
    let caseIndex = 0;
    caseIndex < config.cases.length;
    caseIndex += 1
  ) {
    const benchmarkCase = config.cases[caseIndex];
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

    for (
      let runIndex = 0;
      runIndex < config.runsPerCase;
      runIndex += 1
    ) {
      writeStatus(
        `Production ${benchmarkCase.id}, run ${runIndex + 1}.`,
      );

      const outcome = await removeProductionDefault(
        makeFile(source, benchmarkCase.id),
      );

      if (!outcome.ok) {
        throw new Error(
          `Production ${benchmarkCase.id} run ${runIndex + 1} failed: ${outcome.message}`,
        );
      }

      if (runIndex === 0) {
        await uploadOutput(
          "production-default",
          caseIndex,
          outcome.result.blob,
        );
      }

      const record: ValidationRunRecord = {
        schemaVersion: 1,
        mode: "production-default",
        caseId: benchmarkCase.id,
        run: runIndex + 1,
        engine: outcome.result.engine,
        timings: outcome.result.timings,
      };

      await uploadRun(
        "production-default",
        caseIndex,
        runIndex,
        record,
      );

      productionRuns.push(record);
    }
  }

  for (
    let caseIndex = 0;
    caseIndex < config.cases.length;
    caseIndex += 1
  ) {
    const benchmarkCase = config.cases[caseIndex];
    const inputResponse = await fetch(
      benchmarkCase.inputUrl,
      { cache: "no-store" },
    );

    if (!inputResponse.ok) {
      throw new Error(
        `Could not load capture reference ${benchmarkCase.id}: HTTP ${inputResponse.status}.`,
      );
    }

    const source = await inputResponse.blob();

    writeStatus(
      `Capture reference ${benchmarkCase.id}.`,
    );

    const outcome = await removeCaptureReference(
      makeFile(source, benchmarkCase.id),
    );

    if (!outcome.ok) {
      throw new Error(
        `Capture reference ${benchmarkCase.id} failed: ${outcome.message}`,
      );
    }

    await uploadOutput(
      "capture-reference",
      caseIndex,
      outcome.result.blob,
    );

    const record: ValidationRunRecord = {
      schemaVersion: 1,
      mode: "capture-reference",
      caseId: benchmarkCase.id,
      run: 1,
      engine: outcome.result.engine,
      timings: outcome.result.timings,
    };

    await uploadRun(
      "capture-reference",
      caseIndex,
      0,
      record,
    );

    captureReferenceRuns.push(record);
  }

  const productionWarmTotals = productionRuns
    .filter((record) => record.timings.sessionReused)
    .map((record) => record.timings.totalMs);
  const captureTotals = captureReferenceRuns.map(
    (record) => record.timings.totalMs,
  );

  const report: ValidationReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    defaultStrategy,
    runsPerCase: config.runsPerCase,
    productionRuns,
    captureReferenceRuns,
    summary: {
      productionWarmMedianMs:
        median(productionWarmTotals),
      captureReferenceMedianMs:
        median(captureTotals),
    },
  };

  const response = await fetch("/report", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(report),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  writeStatus("");
  writeStatus("Safari production validation passed.");
};

void main().catch((error) => {
  const parsed =
    error instanceof Error
      ? error
      : new Error(String(error));

  const message =
    `${parsed.message}\n${parsed.stack ?? ""}`;

  writeStatus("");
  writeStatus("SAFARI PRODUCTION VALIDATION FAILED");
  writeStatus(message);

  void fetch("/failure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
});
