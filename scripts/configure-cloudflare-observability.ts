import { Schema } from "effect";

const WRANGLER_VERSION = "4.135.0";

const WORKER_NAME = "bgcut";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/iu;

const OBSERVABILITY = {
  enabled: true,
  head_sampling_rate: 1,
  redact_query_string: true,
  logs: {
    enabled: true,
    invocation_logs: true,
    head_sampling_rate: 1,
    persist: true,
  },
  traces: {
    enabled: true,
    head_sampling_rate: 1,
    persist: true,
  },
  issues: {
    enabled: true,
  },
} as const;

const WranglerCredential = Schema.Struct({
  token: Schema.String,
});

const CloudflareError = Schema.Struct({
  code: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
});

const CloudflareEnvelope = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Unknown,
  errors: Schema.optional(Schema.Array(CloudflareError)),
});

const Account = Schema.Struct({
  id: Schema.String,
});

const Accounts = Schema.Array(Account);

const ScriptSettings = Schema.Struct({
  observability: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      head_sampling_rate: Schema.optional(Schema.Number),
      redact_query_string: Schema.optional(Schema.Boolean),
      logs: Schema.optional(
        Schema.Struct({
          enabled: Schema.optional(Schema.Boolean),
          invocation_logs: Schema.optional(Schema.Boolean),
          head_sampling_rate: Schema.optional(Schema.Number),
          persist: Schema.optional(Schema.Boolean),
        }),
      ),
      traces: Schema.optional(
        Schema.Struct({
          enabled: Schema.optional(Schema.Boolean),
          head_sampling_rate: Schema.optional(Schema.Number),
          persist: Schema.optional(Schema.Boolean),
        }),
      ),
      issues: Schema.optional(
        Schema.Struct({
          enabled: Schema.optional(Schema.Boolean),
        }),
      ),
    }),
  ),
});

type ParsedScriptSettings = typeof ScriptSettings.Type;

const decodeCredential = Schema.decodeUnknownSync(WranglerCredential);

const decodeEnvelope = Schema.decodeUnknownSync(CloudflareEnvelope);

const decodeAccounts = Schema.decodeUnknownSync(Accounts);

const decodeScriptSettings = Schema.decodeUnknownSync(ScriptSettings);

const readProcessText = async (
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> => {
  if (stream === null) {
    return "";
  }

  return new Response(stream).text();
};

const readWranglerToken = async (): Promise<string> => {
  const process = Bun.spawn(
    ["bunx", `wrangler@${WRANGLER_VERSION}`, "auth", "token", "--json"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    readProcessText(process.stdout),
    readProcessText(process.stderr),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Could not obtain the active Wrangler credential: ${stderr.trim() || "unknown error"}`,
    );
  }

  const credential = decodeCredential(JSON.parse(stdout));

  if (credential.token.length === 0) {
    throw new Error("Wrangler did not return an API or OAuth token.");
  }

  return credential.token;
};

const api = async (
  token: string,
  path: string,
  init?: RequestInit,
): Promise<typeof CloudflareEnvelope.Type> => {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  const payload = decodeEnvelope(await response.json());

  if (!response.ok || payload.success !== true) {
    const details = payload.errors
      ?.map((error) => error.message ?? String(error.code ?? "unknown"))
      .join("; ");

    throw new Error(
      `Cloudflare API request failed for ${path}: ${details || response.statusText}`,
    );
  }

  return payload;
};

const workerSettingsPath = (accountId: string): string =>
  `/accounts/${accountId}/workers/scripts/${WORKER_NAME}/script-settings`;

const resolveAccountId = async (token: string): Promise<string> => {
  const configured = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (configured !== undefined && ACCOUNT_ID_PATTERN.test(configured)) {
    return configured;
  }

  const envelope = await api(token, "/accounts?per_page=50");
  const accounts = decodeAccounts(envelope.result);

  if (accounts.length === 1) {
    return accounts[0].id;
  }

  const matches: string[] = [];

  for (const account of accounts) {
    if (!ACCOUNT_ID_PATTERN.test(account.id)) {
      continue;
    }

    const response = await fetch(
      `${CLOUDFLARE_API}${workerSettingsPath(account.id)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    if (response.ok) {
      matches.push(account.id);
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      "Could not resolve exactly one Cloudflare account containing the bgcut Worker.",
    );
  }

  return matches[0];
};

const assertObservability = (settings: ParsedScriptSettings): void => {
  const observability = settings.observability;

  if (
    observability?.enabled !== true ||
    observability.logs?.enabled !== true ||
    observability.logs.invocation_logs !== true ||
    observability.logs.persist !== true ||
    observability.logs.head_sampling_rate !== 1 ||
    observability.traces?.enabled !== true ||
    observability.traces.persist !== true ||
    observability.traces.head_sampling_rate !== 1 ||
    observability.issues?.enabled !== true ||
    observability.redact_query_string !== true
  ) {
    throw new Error(
      "Cloudflare did not persist the required bgcut observability settings.",
    );
  }
};

const token = await readWranglerToken();

const accountId = await resolveAccountId(token);

const path = workerSettingsPath(accountId);

await api(token, path, {
  method: "PATCH",
  body: JSON.stringify({
    observability: OBSERVABILITY,
  }),
});

const confirmed = await api(token, path);

const settings = decodeScriptSettings(confirmed.result);

assertObservability(settings);

console.log(
  "Cloudflare observability confirmed: logs, traces, issues, and 100% sampling are enabled.",
);
