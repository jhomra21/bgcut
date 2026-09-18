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

type CloudflareEnvelope<T> = {
  readonly success: boolean;
  readonly result: T;
  readonly errors?: readonly {
    readonly code?: number;
    readonly message?: string;
  }[];
};

type Account = {
  readonly id: string;
};

type ScriptSettings = {
  readonly observability?: {
    readonly enabled?: boolean;
    readonly head_sampling_rate?: number;
    readonly redact_query_string?: boolean;
    readonly logs?: {
      readonly enabled?: boolean;
      readonly invocation_logs?: boolean;
      readonly head_sampling_rate?: number;
      readonly persist?: boolean;
    };
    readonly traces?: {
      readonly enabled?: boolean;
      readonly head_sampling_rate?: number;
      readonly persist?: boolean;
    };
    readonly issues?: {
      readonly enabled?: boolean;
    };
  };
};

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

  const credential = JSON.parse(stdout) as {
    readonly token?: unknown;
  };

  if (typeof credential.token !== "string" || credential.token.length === 0) {
    throw new Error("Wrangler did not return an API or OAuth token.");
  }

  return credential.token;
};

const api = async <T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<CloudflareEnvelope<T>> => {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  const payload = await response.json() as CloudflareEnvelope<T>;

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

  const accounts = await api<readonly Account[]>(
    token,
    "/accounts?per_page=50",
  );

  if (accounts.result.length === 1) {
    return accounts.result[0].id;
  }

  const matches: string[] = [];

  for (const account of accounts.result) {
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

const assertObservability = (settings: ScriptSettings): void => {
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

await api<ScriptSettings>(token, path, {
  method: "PATCH",
  body: JSON.stringify({
    observability: OBSERVABILITY,
  }),
});

const confirmed = await api<ScriptSettings>(token, path);

assertObservability(confirmed.result);

console.log(
  "Cloudflare observability confirmed: logs, traces, issues, and 100% sampling are enabled.",
);
