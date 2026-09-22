import { Schema } from "effect";

import { removeBrowserBackground } from "../../src/browser/actions";

const ConfigSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
});

const status = document.querySelector<HTMLPreElement>("#status");

if (status === null) {
  throw new Error("Replay benchmark status element is missing.");
}

const writeStatus = (message: string): void => {
  status.textContent += `${message}\n`;
};

const main = async (): Promise<void> => {
  const configResponse = await fetch("/config.json");

  if (!configResponse.ok) {
    throw new Error(
      `Could not load replay config: HTTP ${configResponse.status}.`,
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
      `Could not load replay input: HTTP ${inputResponse.status}.`,
    );
  }

  const source = await inputResponse.blob();
  const runs = [];

  for (let run = 0; run < 3; run += 1) {
    writeStatus(`Run ${run + 1}.`);

    const file = new File(
      [source],
      `${config.id}.png`,
      {
        type: source.type || "image/png",
      },
    );

    const outcome = await removeBrowserBackground(file);

    if (!outcome.ok) {
      throw new Error(
        `Run ${run + 1} failed: ${outcome.message}`,
      );
    }

    const upload = await fetch(
      `/output/${run}`,
      {
        method: "POST",
        body: outcome.result.blob,
      },
    );

    if (!upload.ok) {
      throw new Error(
        `Could not save run ${run + 1}: ${await upload.text()}`,
      );
    }

    runs.push(outcome.result.timings);
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    id: config.id,
    runs,
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

  writeStatus("Replay sentinel passed.");
};

void main().catch((error) => {
  const parsed =
    error instanceof Error
      ? error
      : new Error(String(error));

  const message =
    `${parsed.message}\n${parsed.stack ?? ""}`;

  writeStatus("");
  writeStatus("REPLAY SENTINEL FAILED");
  writeStatus(message);

  void fetch("/failure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
});
