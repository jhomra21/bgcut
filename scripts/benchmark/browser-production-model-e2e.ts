import { Effect, Schema } from "effect";
import sharp from "sharp";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

import {
  MODEL_PUBLIC_PATH,
  MODEL_SHA256,
  MODEL_SIZE_BYTES,
  WEBGPU_MODEL_PUBLIC_PATH,
  WEBGPU_MODEL_REVISION,
  WEBGPU_MODEL_SHA256,
  WEBGPU_MODEL_SIZE_BYTES,
} from "../../src/shared/model-config";
import { inspectModelFile } from "../../src/shared/model-file";
import { ORT_WEBGPU_WASM_PUBLIC_PATH } from "../../src/shared/ort-assets";
import { isSafariUserAgent } from "../../src/browser/webgpu-session-strategy";

const ManifestSchema = Schema.Struct({
  cases: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      input: Schema.String,
      mask: Schema.String,
    }),
  ),
});

const RemovalTimingsSchema = Schema.Struct({
  decodeMs: Schema.Number,
  runtimeMs: Schema.Number,
  modelDownloadMs: Schema.Number,
  sessionInitMs: Schema.Number,
  preprocessMs: Schema.Number,
  inputUploadMs: Schema.Number,
  inferenceMs: Schema.Number,
  outputReadbackMs: Schema.Number,
  matteMs: Schema.Number,
  compositeMs: Schema.Number,
  exportMs: Schema.Number,
  totalMs: Schema.Number,
  sessionReused: Schema.Boolean,
});

const BrowserReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  userAgent: Schema.String,
  caseId: Schema.String,
  modelRevision: Schema.String,
  prime: Schema.Struct({
    timings: RemovalTimingsSchema,
  }),
  warm: Schema.Struct({
    timings: RemovalTimingsSchema,
  }),
});

const FailureSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  message: Schema.String,
  stack: Schema.String,
});

type BrowserReport = Schema.Schema.Type<typeof BrowserReportSchema>;

type BrowserLaunch = {
  readonly pids: readonly number[];
  readonly stdout: string;
  readonly stderr: string;
};

const buildClient = async (): Promise<string> => {
  const build = await Bun.build({
    entrypoints: [
      join(
        import.meta.dir,
        "browser-production-model-client.ts",
      ),
    ],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
  });

  if (!build.success) {
    throw new Error(
      `Could not build production-model smoke client.\n${build.logs
        .map((log) => log.message)
        .join("\n")}`,
    );
  }

  const output = build.outputs.at(0);

  if (output === undefined) {
    throw new Error("Production-model smoke client produced no bundle.");
  }

  return output.text();
};

const clientSource = await buildClient();

if (process.argv.includes("--build-only")) {
  console.log("Browser production-model bundle check passed.");
  process.exit(0);
}

if (process.platform !== "darwin") {
  throw new Error("The Safari production-model smoke requires macOS.");
}

const usage =
  "Usage: bun run benchmark:browser-production-model:e2e -- <manifest.json> <output-dir> <fp32-model.onnx> <fp16-model.onnx> [timeout-ms] [port] [case-id]";

const args = process.argv.slice(2);

if (args.length < 4) {
  throw new Error(usage);
}

const manifestPath = resolve(args[0]);
const outputRoot = resolve(args[1]);
const fp32ModelPath = resolve(args[2]);
const fp16ModelPath = resolve(args[3]);
const timeoutMs = Number.parseInt(args[4] ?? "60000", 10);
const port = Number.parseInt(args[5] ?? "4184", 10);
const caseId = args[6] ?? "cat-in-sink";

if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
  throw new Error(`Timeout must be a positive integer, received "${args[4]}".`);
}

if (!Number.isInteger(port) || port < 1) {
  throw new Error(`Port must be a positive integer, received "${args[5]}".`);
}

const manifest = Schema.decodeUnknownSync(ManifestSchema)(
  JSON.parse(await readFile(manifestPath, "utf8")),
);

const benchmarkCase = manifest.cases.find((candidate) => candidate.id === caseId);

if (benchmarkCase === undefined) {
  throw new Error(`Benchmark case "${caseId}" was not found in ${manifestPath}.`);
}

const manifestRoot = dirname(manifestPath);

const [
  fp32Fingerprint,
  fp16Fingerprint,
] = await Promise.all([
  Effect.runPromise(inspectModelFile(fp32ModelPath)),
  Effect.runPromise(inspectModelFile(fp16ModelPath)),
]);

if (
  fp32Fingerprint?.sizeBytes !== MODEL_SIZE_BYTES ||
  fp32Fingerprint.sha256 !== MODEL_SHA256
) {
  throw new Error("FP32 smoke model does not match the validated production artifact.");
}

if (
  fp16Fingerprint?.sizeBytes !== WEBGPU_MODEL_SIZE_BYTES ||
  fp16Fingerprint.sha256 !== WEBGPU_MODEL_SHA256
) {
  throw new Error("FP16 smoke model does not match the validated Safari artifact.");
}

const runtimePath = resolve(
  import.meta.dir,
  "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
);

const runtimeFile = Bun.file(runtimePath);

if (!(await runtimeFile.exists())) {
  throw new Error(`ONNX Runtime WebGPU runtime is missing at ${runtimePath}.`);
}

await rm(outputRoot, {
  recursive: true,
  force: true,
});

await mkdir(outputRoot, {
  recursive: true,
});

const sessionToken = crypto.randomUUID();
const sessionPath = `/session/${encodeURIComponent(sessionToken)}`;
const baseUrl = `http://127.0.0.1:${port}/`;
const modelRequests: string[] = [];
let completed = false;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bgcut Safari production model smoke</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js?session=${encodeURIComponent(sessionToken)}"></script>
  </body>
</html>
`;

const writeReport = async (report: BrowserReport): Promise<void> => {
  if (!isSafariUserAgent(report.userAgent)) {
    throw new Error("Production-model smoke report did not come from Safari.");
  }

  if (report.modelRevision !== WEBGPU_MODEL_REVISION) {
    throw new Error(
      `Safari reported model revision ${report.modelRevision}; expected ${WEBGPU_MODEL_REVISION}.`,
    );
  }

  if (report.prime.timings.sessionReused) {
    throw new Error("Production-model smoke prime unexpectedly reused a session.");
  }

  if (!report.warm.timings.sessionReused) {
    throw new Error("Production-model smoke warm removal did not reuse its session.");
  }

  const fp16Requests = modelRequests.filter(
    (path) => path === WEBGPU_MODEL_PUBLIC_PATH,
  ).length;

  const fp32Requests = modelRequests.filter(
    (path) => path === MODEL_PUBLIC_PATH,
  ).length;

  if (fp16Requests < 1) {
    throw new Error("Safari did not request the FP16 production model.");
  }

  if (fp32Requests !== 0) {
    throw new Error(
      `Safari requested the FP32 production model ${fp32Requests} time(s).`,
    );
  }

  await writeFile(
    join(outputRoot, "browser-production-model.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        report,
        modelRequests,
        expectedModelPath: WEBGPU_MODEL_PUBLIC_PATH,
        unexpectedModelPath: MODEL_PUBLIC_PATH,
      },
      null,
      2,
    )}\n`,
  );

  completed = true;
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const authorized =
      request.headers.get("x-bgcut-benchmark-session") === sessionToken;

    if (request.method === "POST" && !authorized) {
      return new Response("Unauthorized smoke session.", {
        status: 403,
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("bgcut production-model smoke server ready.", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (request.method === "GET" && url.pathname === sessionPath) {
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/client.js" &&
      url.searchParams.get("session") === sessionToken
    ) {
      return new Response(clientSource, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/config.json" &&
      url.searchParams.get("session") === sessionToken
    ) {
      return Response.json(
        {
          caseId,
          inputUrl: "/input",
          expectedModelRevision: WEBGPU_MODEL_REVISION,
          timeoutMs,
        },
        {
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    }

    if (request.method === "GET" && url.pathname === "/input") {
      return new Response(
        Bun.file(resolve(manifestRoot, benchmarkCase.input)),
        {
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    }

    if (
      request.method === "GET" &&
      (
        url.pathname === MODEL_PUBLIC_PATH ||
        url.pathname === WEBGPU_MODEL_PUBLIC_PATH
      )
    ) {
      modelRequests.push(url.pathname);

      const model =
        url.pathname === WEBGPU_MODEL_PUBLIC_PATH
          ? Bun.file(fp16ModelPath)
          : Bun.file(fp32ModelPath);

      return new Response(model, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === ORT_WEBGPU_WASM_PUBLIC_PATH
    ) {
      return new Response(runtimeFile, {
        headers: {
          "content-type": "application/wasm",
          "cache-control": "no-store",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/output") {
      const outputPath = join(outputRoot, "output.png");

      await writeFile(
        outputPath,
        new Uint8Array(await request.arrayBuffer()),
      );

      const stats = await sharp(outputPath).ensureAlpha().stats();
      const alpha = stats.channels.at(3);

      if (alpha === undefined || alpha.max === 0) {
        return new Response("Production-model smoke output is fully transparent.", {
          status: 422,
        });
      }

      return new Response("saved");
    }

    if (request.method === "POST" && url.pathname === "/report") {
      try {
        const report = Schema.decodeUnknownSync(BrowserReportSchema)(
          await request.json(),
        );

        await writeReport(report);

        return new Response("saved");
      } catch (error) {
        return new Response(
          error instanceof Error ? error.message : String(error),
          {
            status: 422,
          },
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/failure") {
      const failure = Schema.decodeUnknownSync(FailureSchema)(
        await request.json(),
      );

      await writeFile(
        join(outputRoot, "browser-failure.json"),
        `${JSON.stringify(failure, null, 2)}\n`,
      );

      return new Response("saved");
    }

    return new Response("Not found.", {
      status: 404,
    });
  },
});

const readPipe = (
  pipe: number | ReadableStream<Uint8Array> | undefined,
): Promise<string> =>
  pipe instanceof ReadableStream
    ? new Response(pipe).text()
    : Promise.resolve("");

const appExists = async (appName: string): Promise<boolean> => {
  const process = Bun.spawn(
    [
      "open",
      "-Ra",
      appName,
    ],
    {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  return (await process.exited) === 0;
};

let browserApp: string | undefined;

for (const appName of ["Safari", "Safari Technology Preview"]) {
  if (await appExists(appName)) {
    browserApp = appName;

    break;
  }
}

if (browserApp === undefined) {
  server.stop(true);

  throw new Error("Safari was not found.");
}

const browserProcessIds = async (): Promise<ReadonlySet<number>> => {
  const process = Bun.spawn(
    [
      "ps",
      "-axo",
      "pid=,comm=",
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [
    stdout,
    stderr,
    exitCode,
  ] = await Promise.all([
    readPipe(process.stdout),
    readPipe(process.stderr),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Could not inspect Safari processes.\n${stderr || stdout}`);
  }

  const ids = new Set<number>();

  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/u);

    if (match === null) {
      continue;
    }

    if (basename(match[2].trim()) !== browserApp) {
      continue;
    }

    ids.add(Number.parseInt(match[1], 10));
  }

  return ids;
};

const launchBrowser = async (url: string): Promise<BrowserLaunch> => {
  const before = await browserProcessIds();

  const process = Bun.spawn(
    [
      "open",
      "-na",
      browserApp,
      url,
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [
    stdout,
    stderr,
    exitCode,
  ] = await Promise.all([
    readPipe(process.stdout),
    readPipe(process.stderr),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Could not launch ${browserApp}.\n${stderr || stdout}`);
  }

  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const after = await browserProcessIds();
    const added = [...after].filter((pid) => !before.has(pid));

    if (added.length > 0) {
      return {
        pids: added,
        stdout,
        stderr,
      };
    }

    await Bun.sleep(100);
  }

  throw new Error(`Could not identify the newly launched ${browserApp} process.`);
};

const signalProcesses = async (
  pids: readonly number[],
  signal: "-TERM" | "-KILL",
): Promise<void> => {
  await Promise.all(
    pids.map(async (pid) => {
      const process = Bun.spawn(
        [
          "kill",
          signal,
          String(pid),
        ],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        },
      );

      await process.exited;
    }),
  );
};

const terminateBrowser = async (pids: readonly number[]): Promise<void> => {
  if (pids.length === 0) {
    return;
  }

  await signalProcesses(pids, "-TERM");

  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const active = await browserProcessIds();

    if (pids.every((pid) => !active.has(pid))) {
      return;
    }

    await Bun.sleep(100);
  }

  await signalProcesses(pids, "-KILL");
};

let launch: BrowserLaunch | undefined;

try {
  launch = await launchBrowser(
    `${baseUrl}session/${encodeURIComponent(sessionToken)}`,
  );

  const deadline = Date.now() + timeoutMs * 2 + 60_000;
  const failurePath = join(outputRoot, "browser-failure.json");
  const reportPath = join(outputRoot, "browser-production-model.json");

  while (Date.now() < deadline) {
    if (await Bun.file(failurePath).exists()) {
      throw new Error(
        `Production-model smoke failed.\n${await readFile(failurePath, "utf8")}`,
      );
    }

    if (completed && (await Bun.file(reportPath).exists())) {
      break;
    }

    await Bun.sleep(200);
  }

  if (!completed || !(await Bun.file(reportPath).exists())) {
    throw new Error("Timed out waiting for the Safari production-model smoke report.");
  }

  const result = Schema.decodeUnknownSync(
    Schema.Struct({
      report: BrowserReportSchema,
      modelRequests: Schema.Array(Schema.String),
      expectedModelPath: Schema.String,
      unexpectedModelPath: Schema.String,
    }),
  )(
    JSON.parse(await readFile(reportPath, "utf8")),
  );

  await Promise.all([
    writeFile(
      join(outputRoot, "browser-stdout.log"),
      launch.stdout,
    ),
    writeFile(
      join(outputRoot, "browser-stderr.log"),
      launch.stderr,
    ),
  ]);

  console.log(
    `Safari production-model smoke passed. Requested ${result.expectedModelPath}; FP32 requests: ${result.modelRequests.filter((path) => path === result.unexpectedModelPath).length}. Warm inference ${result.report.warm.timings.inferenceMs.toFixed(1)} ms, total ${result.report.warm.timings.totalMs.toFixed(1)} ms.`,
  );
} finally {
  if (launch !== undefined) {
    await terminateBrowser(launch.pids);
  }

  server.stop(true);
}
