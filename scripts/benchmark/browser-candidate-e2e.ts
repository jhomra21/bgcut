import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const usage =
  "Usage: bun run benchmark:browser-candidate:e2e -- <manifest.json> <output-dir> <model.onnx> <input-size> [warm-repeats] [port]";

type BrowserTarget =
  | {
      readonly kind: "chromium";
      readonly name: string;
      readonly executable: string;
    }
  | {
      readonly kind: "macos-open";
      readonly name: string;
      readonly appName: string;
      readonly experimental: boolean;
    };

const chromiumCandidates = (): readonly {
  readonly name: string;
  readonly executable: string;
}[] => {
  const configured =
    process.env.BGCUT_BROWSER_PATH ??
    process.env.BGCUT_CHROME_PATH;

  return [
    ...(configured === undefined
      ? []
      : [{ name: "configured browser", executable: configured }]),
    {
      name: "Google Chrome",
      executable:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    {
      name: "Google Chrome Canary",
      executable:
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    },
    {
      name: "Microsoft Edge",
      executable:
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    },
    {
      name: "Brave Browser",
      executable:
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    },
    {
      name: "Chromium",
      executable:
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    },
    {
      name: "Arc",
      executable:
        "/Applications/Arc.app/Contents/MacOS/Arc",
    },
    {
      name: "Vivaldi",
      executable:
        "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
    },
    {
      name: "Opera",
      executable:
        "/Applications/Opera.app/Contents/MacOS/Opera",
    },
    {
      name: "Google Chrome",
      executable: "/usr/bin/google-chrome",
    },
    {
      name: "Google Chrome",
      executable: "/usr/bin/google-chrome-stable",
    },
    {
      name: "Microsoft Edge",
      executable: "/usr/bin/microsoft-edge",
    },
    {
      name: "Brave Browser",
      executable: "/usr/bin/brave-browser",
    },
    {
      name: "Chromium",
      executable: "/usr/bin/chromium",
    },
    {
      name: "Chromium",
      executable: "/usr/bin/chromium-browser",
    },
  ];
};

const readSubprocessPipe = (
  pipe: number | ReadableStream<Uint8Array> | undefined,
): Promise<string> => {
  if (!(pipe instanceof ReadableStream)) {
    return Promise.resolve("");
  }

  return new Response(pipe).text();
};

const macosAppExists = async (appName: string): Promise<boolean> => {
  const check = Bun.spawn(
    ["open", "-Ra", appName],
    {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  return (await check.exited) === 0;
};

const findBrowser = async (): Promise<BrowserTarget> => {
  for (const candidate of chromiumCandidates()) {
    try {
      await access(candidate.executable);

      return {
        kind: "chromium",
        name: candidate.name,
        executable: candidate.executable,
      };
    } catch {
      // Try the next Chromium-family installation.
    }
  }

  if (process.platform === "darwin") {
    for (const appName of [
      "Safari Technology Preview",
      "Safari",
    ]) {
      if (await macosAppExists(appName)) {
        return {
          kind: "macos-open",
          name: appName,
          appName,
          experimental: true,
        };
      }
    }
  }

  throw new Error(
    "No supported browser was found. Install a Chromium-family browser, use Safari on macOS, or set BGCUT_BROWSER_PATH to a Chromium executable.",
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

  throw new Error(
    `Browser benchmark server did not become ready at ${url}.`,
  );
};

const waitForArtifacts = async (
  outputRoot: string,
  browser: Bun.Subprocess | undefined,
  browserName: string,
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

      throw new Error(
        `Browser benchmark reported a failure.\n${failure}`,
      );
    }

    if (
      (await Bun.file(reportPath).exists()) &&
      (await Bun.file(qualityPath).exists())
    ) {
      return;
    }

    if (browser?.exitCode !== null && browser !== undefined) {
      throw new Error(
        `${browserName} exited before the benchmark completed with code ${browser.exitCode}.`,
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

const launchChromium = (
  target: Extract<BrowserTarget, { readonly kind: "chromium" }>,
  profileDirectory: string,
  url: string,
): {
  readonly process: Bun.Subprocess;
  readonly stdout: Promise<string>;
  readonly stderr: Promise<string>;
} => {
  const process = Bun.spawn(
    [
      target.executable,
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

  return {
    process,
    stdout: readSubprocessPipe(process.stdout),
    stderr: readSubprocessPipe(process.stderr),
  };
};

const launchMacosApp = async (
  target: Extract<BrowserTarget, { readonly kind: "macos-open" }>,
  url: string,
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
}> => {
  const process = Bun.spawn(
    ["open", "-na", target.appName, url],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = readSubprocessPipe(process.stdout);
  const stderr = readSubprocessPipe(process.stderr);
  const exitCode = await process.exited;
  const [capturedStdout, capturedStderr] = await Promise.all([
    stdout,
    stderr,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Could not launch ${target.name} with macOS open.\n${capturedStderr || capturedStdout}`,
    );
  }

  return {
    stdout: capturedStdout,
    stderr: capturedStderr,
  };
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

const browserTarget = await findBrowser();

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

const serverStdout = readSubprocessPipe(server.stdout);

const serverStderr = readSubprocessPipe(server.stderr);

let browser: Bun.Subprocess | undefined;

let browserStdout: Promise<string> = Promise.resolve("");

let browserStderr: Promise<string> = Promise.resolve("");

try {
  await waitForServer(url, server);

  console.log(`Launching ${browserTarget.name}.`);

  if (
    browserTarget.kind === "macos-open" &&
    browserTarget.experimental
  ) {
    console.log(
      "Safari fallback is experimental for ONNX Runtime WebGPU. The benchmark will record any browser-side failure.",
    );
  }

  console.log(`Benchmark URL: ${url}`);

  if (browserTarget.kind === "chromium") {
    const launched = launchChromium(
      browserTarget,
      profileDirectory,
      url,
    );

    browser = launched.process;
    browserStdout = launched.stdout;
    browserStderr = launched.stderr;
  } else {
    const launched = await launchMacosApp(
      browserTarget,
      url,
    );

    browserStdout = Promise.resolve(launched.stdout);
    browserStderr = Promise.resolve(launched.stderr);
  }

  await waitForArtifacts(
    outputRoot,
    browser,
    browserTarget.name,
    server,
  );

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
    browserStdout,
    browserStderr,
  ]);

  await Promise.all([
    writeFile(
      join(outputRoot, "server-stdout.log"),
      capturedServerStdout,
    ),
    writeFile(
      join(outputRoot, "server-stderr.log"),
      capturedServerStderr,
    ),
    writeFile(
      join(outputRoot, "browser-stdout.log"),
      capturedBrowserStdout,
    ),
    writeFile(
      join(outputRoot, "browser-stderr.log"),
      capturedBrowserStderr,
    ),
    rm(profileDirectory, { recursive: true, force: true }),
  ]);
}
