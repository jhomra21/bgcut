import { Effect, Schema } from "effect";

import { formatBackgroundRemovalError } from "../../src/browser/errors";
import { removeBackgroundWebGpu } from "../../src/browser/inference";
import { resolveDefaultWebGpuSessionStrategy } from "../../src/browser/webgpu-session-strategy";

const ConfigSchema = Schema.Struct({
  caseId: Schema.String,
  inputUrl: Schema.String,
  expectedModelRevision: Schema.String,
  timeoutMs: Schema.Number,
});

const ReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  userAgent: Schema.String,
  caseId: Schema.String,
  modelRevision: Schema.String,
  prime: Schema.Struct({
    timings: Schema.Unknown,
  }),
  warm: Schema.Struct({
    timings: Schema.Unknown,
  }),
});

type Report = Schema.Schema.Type<typeof ReportSchema>;

const status = document.querySelector<HTMLPreElement>("#status");

if (status === null) {
  throw new Error("Production-model smoke status element is missing.");
}

const writeStatus = (message: string): void => {
  status.textContent += `${message}\n`;
};

const sessionTokenFromLocation = (): string => {
  const match = globalThis.location.pathname.match(/^\/session\/([^/]+)$/u);

  if (match === null) {
    throw new Error("Production-model smoke is not running from an authorized session URL.");
  }

  return decodeURIComponent(match[1]);
};

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
};

const remove = async (source: Blob, caseId: string) =>
  Effect.runPromise(
    removeBackgroundWebGpu(
      new File([source], `${caseId}.png`, {
        type: source.type || "image/png",
      }),
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

const post = async (
  path: string,
  sessionToken: string,
  body: BodyInit,
  contentType?: string,
): Promise<Response> => {
  const headers = new Headers({
    "x-bgcut-benchmark-session": sessionToken,
  });

  if (contentType !== undefined) {
    headers.set("content-type", contentType);
  }

  const response = await fetch(path, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response;
};

const main = async (): Promise<void> => {
  const sessionToken = sessionTokenFromLocation();

  if (
    resolveDefaultWebGpuSessionStrategy(navigator.userAgent) !==
    "no-capture-reuse"
  ) {
    throw new Error("Production-model smoke must run on Safari's no-capture path.");
  }

  const configResponse = await fetch(
    `/config.json?session=${encodeURIComponent(sessionToken)}`,
    {
      cache: "no-store",
    },
  );

  if (!configResponse.ok) {
    throw new Error(
      `Could not load production-model smoke config: HTTP ${configResponse.status}.`,
    );
  }

  const config = Schema.decodeUnknownSync(ConfigSchema)(
    await configResponse.json(),
  );

  const inputResponse = await fetch(config.inputUrl, {
    cache: "no-store",
  });

  if (!inputResponse.ok) {
    throw new Error(
      `Could not load ${config.caseId}: HTTP ${inputResponse.status}.`,
    );
  }

  const source = await inputResponse.blob();

  writeStatus(`Running ${config.caseId} through the normal Safari WebGPU selector.`);

  const prime = await withTimeout(
    remove(source, config.caseId),
    config.timeoutMs,
    "Production Safari prime",
  );

  if (!prime.ok) {
    throw new Error(prime.message);
  }

  if (prime.result.timings.sessionReused) {
    throw new Error("Production Safari prime unexpectedly reused a session.");
  }

  if (prime.result.modelRevision !== config.expectedModelRevision) {
    throw new Error(
      `Production Safari prime returned model revision ${prime.result.modelRevision}; expected ${config.expectedModelRevision}.`,
    );
  }

  const warm = await withTimeout(
    remove(source, config.caseId),
    config.timeoutMs,
    "Production Safari warm removal",
  );

  if (!warm.ok) {
    throw new Error(warm.message);
  }

  if (!warm.result.timings.sessionReused) {
    throw new Error("Production Safari warm removal did not reuse its session.");
  }

  if (warm.result.modelRevision !== config.expectedModelRevision) {
    throw new Error(
      `Production Safari warm removal returned model revision ${warm.result.modelRevision}; expected ${config.expectedModelRevision}.`,
    );
  }

  await post(
    "/output",
    sessionToken,
    warm.result.blob,
  );

  const report = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    caseId: config.caseId,
    modelRevision: warm.result.modelRevision,
    prime: {
      timings: prime.result.timings,
    },
    warm: {
      timings: warm.result.timings,
    },
  } satisfies Report;

  await post(
    "/report",
    sessionToken,
    JSON.stringify(report),
    "application/json",
  );

  writeStatus(
    `PASS: FP16 revision ${report.modelRevision}, warm total ${warm.result.timings.totalMs.toFixed(1)} ms.`,
  );
};

void main().catch(async (error) => {
  const parsed = error instanceof Error ? error : new Error(String(error));

  writeStatus("");
  writeStatus("PRODUCTION MODEL SMOKE FAILED");
  writeStatus(parsed.message);

  try {
    await post(
      "/failure",
      sessionTokenFromLocation(),
      JSON.stringify({
        schemaVersion: 1,
        message: parsed.message,
        stack: parsed.stack ?? "",
      }),
      "application/json",
    );
  } catch {
    // The original failure remains visible in the page.
  }
});
