import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import {
  removeBackgroundWebGpuWithStrategy,
  type BrowserInferenceEngine,
} from "../../src/browser/inference";
import type { RemovalTimings } from "../../src/browser/timing";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
  caseIndex: Schema.Number,
});

const ConfigSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
});

type ReferenceRunRecord = {
  readonly schemaVersion: 1;
  readonly mode: "capture-reference";
  readonly caseId: string;
  readonly caseIndex: number;
  readonly engine: BrowserInferenceEngine;
  readonly timings: RemovalTimings;
};

const status = document.querySelector<HTMLPreElement>("#status");

if (status === null) {
  throw new Error("Reference resume status element is missing.");
}

const writeStatus = (message: string): void => {
  status.textContent += `${message}\n`;
};

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

const main = async (): Promise<void> => {
  const configResponse = await fetch("/config.json");

  if (!configResponse.ok) {
    throw new Error(
      `Could not load reference resume config: HTTP ${configResponse.status}.`,
    );
  }

  const config = Schema.decodeUnknownSync(ConfigSchema)(
    await configResponse.json(),
  );

  if (config.cases.length === 0) {
    writeStatus("All captured references already exist.");
  }

  for (const benchmarkCase of config.cases) {
    writeStatus(
      `Capture reference ${benchmarkCase.id}.`,
    );

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
    const file = new File(
      [source],
      `${benchmarkCase.id}.png`,
      {
        type: source.type || "image/png",
      },
    );
    const outcome = await removeCaptureReference(file);

    if (!outcome.ok) {
      throw new Error(
        `Capture reference ${benchmarkCase.id} failed: ${outcome.message}`,
      );
    }

    const record: ReferenceRunRecord = {
      schemaVersion: 1,
      mode: "capture-reference",
      caseId: benchmarkCase.id,
      caseIndex: benchmarkCase.caseIndex,
      engine: outcome.result.engine,
      timings: outcome.result.timings,
    };

    const timingResponse = await fetch(
      `/run/${benchmarkCase.caseIndex}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(record),
      },
    );

    if (!timingResponse.ok) {
      throw new Error(
        `Could not save ${benchmarkCase.id} timing: ${await timingResponse.text()}`,
      );
    }

    const outputResponse = await fetch(
      `/output/${benchmarkCase.caseIndex}`,
      {
        method: "POST",
        body: outcome.result.blob,
      },
    );

    if (!outputResponse.ok) {
      throw new Error(
        `Could not save ${benchmarkCase.id} output: ${await outputResponse.text()}`,
      );
    }
  }

  const finalizeResponse = await fetch(
    "/finalize",
    {
      method: "POST",
    },
  );

  if (!finalizeResponse.ok) {
    throw new Error(
      await finalizeResponse.text(),
    );
  }

  writeStatus("");
  writeStatus("Reference resume passed.");
};

void main().catch((error) => {
  const parsed =
    error instanceof Error
      ? error
      : new Error(String(error));

  const message =
    `${parsed.message}\n${parsed.stack ?? ""}`;

  writeStatus("");
  writeStatus("REFERENCE RESUME FAILED");
  writeStatus(message);

  void fetch("/failure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
});
