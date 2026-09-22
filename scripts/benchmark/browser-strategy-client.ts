import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import {
  removeBackgroundWebGpuWithStrategy,
  type BrowserInferenceEngine,
  type WebGpuSessionStrategy,
} from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";

const ConfigSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
  runsPerStrategy: Schema.Number,
});

const strategies = [
  "no-capture-reuse",
  "capture-recreate",
] as const satisfies readonly WebGpuSessionStrategy[];

type StrategyRunRecord = {
  readonly schemaVersion: 1;
  readonly strategy: WebGpuSessionStrategy;
  readonly run: number;
  readonly engine: BrowserInferenceEngine;
  readonly timings: RemovalTimings;
};

type StrategyReportEntry = {
  readonly strategy: WebGpuSessionStrategy;
  readonly runs: StrategyRunRecord[];
};

type StrategyReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly id: string;
  readonly runsPerStrategy: number;
  readonly strategies: StrategyReportEntry[];
};

const status = document.querySelector<HTMLPreElement>("#status");

if (status === null) {
  throw new Error("Strategy benchmark status element is missing.");
}

const writeStatus = (message: string): void => {
  status.textContent += `${message}\n`;
};

const removeWithStrategy = async (
  file: File,
  strategy: WebGpuSessionStrategy,
) =>
  Effect.runPromise(
    removeBackgroundWebGpuWithStrategy(file, strategy).pipe(
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

const main = async (): Promise<void> => {
  const configResponse = await fetch("/config.json");

  if (!configResponse.ok) {
    throw new Error(
      `Could not load strategy config: HTTP ${configResponse.status}.`,
    );
  }

  const config = Schema.decodeUnknownSync(ConfigSchema)(
    await configResponse.json(),
  );

  const inputResponse = await fetch(
    config.inputUrl,
    { cache: "no-store" },
  );

  if (!inputResponse.ok) {
    throw new Error(
      `Could not load strategy input: HTTP ${inputResponse.status}.`,
    );
  }

  const source = await inputResponse.blob();

  const report: StrategyReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    id: config.id,
    runsPerStrategy: config.runsPerStrategy,
    strategies: [],
  };

  for (const strategy of strategies) {
    writeStatus("");
    writeStatus(`Strategy: ${strategy}`);

    const runs: StrategyRunRecord[] = [];

    for (
      let run = 0;
      run < config.runsPerStrategy;
      run += 1
    ) {
      writeStatus(`  Run ${run + 1}`);

      const file = new File(
        [source],
        `${config.id}.png`,
        {
          type: source.type || "image/png",
        },
      );

      const outcome = await removeWithStrategy(
        file,
        strategy,
      );

      if (!outcome.ok) {
        throw new Error(
          `${strategy} run ${run + 1} failed: ${outcome.message}`,
        );
      }

      const outputResponse = await fetch(
        `/output/${strategy}/${run}`,
        {
          method: "POST",
          body: outcome.result.blob,
        },
      );

      if (!outputResponse.ok) {
        throw new Error(
          `Could not save ${strategy} run ${run + 1}: ${await outputResponse.text()}`,
        );
      }

      const runRecord: StrategyRunRecord = {
        schemaVersion: 1,
        strategy,
        run: run + 1,
        engine: outcome.result.engine,
        timings: outcome.result.timings,
      };

      const runResponse = await fetch(
        `/run/${strategy}/${run}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(runRecord),
        },
      );

      if (!runResponse.ok) {
        throw new Error(
          `Could not save ${strategy} run ${run + 1} timing: ${await runResponse.text()}`,
        );
      }

      runs.push(runRecord);
    }

    report.strategies.push({
      strategy,
      runs,
    });
  }

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
  writeStatus("Strategy benchmark passed.");
};

void main().catch((error) => {
  const parsed =
    error instanceof Error
      ? error
      : new Error(String(error));

  const message =
    `${parsed.message}\n${parsed.stack ?? ""}`;

  writeStatus("");
  writeStatus("STRATEGY BENCHMARK FAILED");
  writeStatus(message);

  void fetch("/failure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
});
