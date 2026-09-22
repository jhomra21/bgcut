import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const usage =
  "Usage: bun run benchmark:browser-candidate:e2e -- <manifest.json> <output-dir> <model.onnx> <input-size> [warm-repeats] [port]";

const chromeCandidates = (): readonly string[] => {
  const configured = process.env.BGCUT_CHROME_PATH;

  return [
    ...(configured === undefined ? [] : [configured]),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
};

const findChrome = async (): Promise<string> => {
  for (const candidate of chromeCandidates()) {
    try {
      await access(candidate);

      return candidate;
    } catch {
      // Try the next known Chrome or Chromium installation.
    }
  }

  throw new Error(
    "Chrome or Chromium was not found. Set BGCUT_CHROME_PATH to the browser executable.",
  );
};

const waitForServer = async (
  url: string,
  server: Bun.Subprocess,
): Promise<void> => {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Browser benchmark server exited before becoming ready with code ${server.exitCode}.`,
      );
    }

    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // The server may still be starting.
    }

    await Bun.sleep(200);
  }

  throw new Error(`Browser benchmark server did not become ready at ${url}.`);
};

const waitForArtifacts = async (
  outputRoot: string,
  browser: Bun.Subprocess,
  server: Bun.Subprocess,
): Promise<void> => {
  const reportPath = join(outputRoot, "browser-timings.json");
  const qualityPath = join(outputRoot, "quality.json");
  const failurePath = join(outputRoot, "browser-failure.json");

  const timeoutMs = Number.parseInt(
    process.env.BGCUT_BROWSER_BENCHMARK_TIMEOUT_MS ?? "900000",
    10,
  );

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await Bun.file(failurePath).exists()) {
      const failure = await readFile(failurePath, "utf8");

      throw new Error(`Browser benchmark reported a failure.\n${failure}`);
    }

    if (
      (await Bun.file(reportPath).exists()) &&
      (await Bun.file(qualityPath).exists())
    ) {
      return;
    }

    if (browser.exitCode !== null) {
      throw new Error(
        `Chrome exited before the benchmark completed with code ${browser.exitCode}.`,
      );
    }

    if (server.exitCode !== null) {
      throw new Error(
        `Browser benchmark server exited before completion with code ${server.exitCode}.`,
      );
    }

    await Bun.sleep(500);
  }

  throw new Error(
    `Browser benchmark timed out after ${timeoutMs} ms without producing its report.`,
  );
};

const args = process.argv.slice(2);

if (args.length < 4) {
  throw new Error(usage);
}

const outputRoot = resolve(args[1]);

const port = args[5] ?? "4177";

const url = `http://127.0.0.1:${port}/`;

const repoRoot = resolve(import.meta.dir, "../..");

const reportPath = join(outputRoot, "browser-timings.json");

const qualityPath = join(outputRoot, "quality.json");

const failurePath = join(outputRoot, "browser-failure.json");

await mkdir(outputRoot, { recursive: true });

await Promise.all([
  rm(reportPath, { force: true }),
  rm(qualityPath, { force: true }),
  rm(failurePath, { force: true }),
]);

const chromePath = await findChrome();

const profileDirectory = await mkdtemp(
  join(tmpdir(), "bgcut-browser-benchmark-"),
);

const server = Bun.spawn(
  [
    "bun",
    "run",
    "scripts/benchmark/browser-candidate-server.ts",
    ...args,
  ],
  {
    cwd: repoRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  },
);

const serverStdout = new Response(server.stdout).text();

const serverStderr = new Response(server.stderr).text();

let browser: Bun.Subprocess | undefined;

let browserStdout: Promise<string> | undefined;

let browserStderr: Promise<string> | undefined;

try {
  await waitForServer(url, server);

  console.log(`Launching ${chromePath}.`);
  console.log(`Benchmark URL: ${url}`);

  browser = Bun.spawn(
    [
      chromePath,
      `--user-data-dir=${profileDirectory}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--metrics-recording-only",
      `--app=${url}`,
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  browserStdout = new Response(browser.stdout).text();
  browserStderr = new Response(browser.stderr).text();

  await waitForArtifacts(outputRoot, browser, server);

  console.log("Browser benchmark completed.");
  console.log(`Timings: ${reportPath}`);
  console.log(`Quality: ${qualityPath}`);
} finally {
  browser?.kill();
  server.kill();

  const [
    capturedServerStdout,
    capturedServerStderr,
    capturedBrowserStdout,
    capturedBrowserStderr,
  ] = await Promise.all([
    serverStdout,
    serverStderr,
    browserStdout ?? Promise.resolve(""),
    browserStderr ?? Promise.resolve(""),
  ]);

  await Promise.all([
    writeFile(join(outputRoot, "server-stdout.log"), capturedServerStdout),
    writeFile(join(outputRoot, "server-stderr.log"), capturedServerStderr),
    writeFile(join(outputRoot, "chrome-stdout.log"), capturedBrowserStdout),
    writeFile(join(outputRoot, "chrome-stderr.log"), capturedBrowserStderr),
    rm(profileDirectory, { recursive: true, force: true }),
  ]);
}
