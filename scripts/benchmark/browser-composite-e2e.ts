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
  "Usage: bun run benchmark:browser-composite:e2e -- <manifest.json> <output-dir> <model.onnx> [warm-repeats] [port]";

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
      : [{
          name: "configured browser",
          executable: configured,
        }]),
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
      name: "Chromium",
      executable: "/usr/bin/chromium",
    },
  ];
};

const readPipe = (
  pipe: number | ReadableStream<Uint8Array> | undefined,
): Promise<string> =>
  pipe instanceof ReadableStream
    ? new Response(pipe).text()
    : Promise.resolve("");

const appExists = async (
  appName: string,
): Promise<boolean> => {
  const process = Bun.spawn(
    ["open", "-Ra", appName],
    {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  return (await process.exited) === 0;
};

const findBrowser =
  async (): Promise<BrowserTarget> => {
    for (const candidate of chromiumCandidates()) {
      try {
        await access(candidate.executable);

        return {
          kind: "chromium",
          name: candidate.name,
          executable: candidate.executable,
        };
      } catch {
        // Try the next installed browser.
      }
    }

    if (process.platform === "darwin") {
      for (const appName of [
        "Safari Technology Preview",
        "Safari",
      ]) {
        if (await appExists(appName)) {
          return {
            kind: "macos-open",
            name: appName,
            appName,
          };
        }
      }
    }

    throw new Error(
      "No supported browser was found.",
    );
  };

const args = process.argv.slice(2);

if (args.length < 3) {
  throw new Error(usage);
}

const outputRoot = resolve(args[1]);

const port = args[4] ?? "4180";

const url = `http://127.0.0.1:${port}/`;

await mkdir(outputRoot, { recursive: true });

for (const path of [
  "browser-timings.json",
  "browser-failure.json",
  "pixel-comparison.json",
]) {
  await rm(
    join(outputRoot, path),
    { force: true },
  );
}

const browserTarget = await findBrowser();

const profileDirectory = await mkdtemp(
  join(tmpdir(), "bgcut-composite-benchmark-"),
);

const server = Bun.spawn(
  [
    "bun",
    "run",
    "scripts/benchmark/browser-composite-server.ts",
    ...args,
  ],
  {
    cwd: resolve(import.meta.dir, "../.."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  },
);

const serverStdout = readPipe(server.stdout);

const serverStderr = readPipe(server.stderr);

const deadline = Date.now() + 20_000;

while (Date.now() < deadline) {
  if (server.exitCode !== null) {
    throw new Error(
      `Benchmark server exited with code ${server.exitCode}.`,
    );
  }

  try {
    const response = await fetch(url);

    if (response.ok) {
      break;
    }
  } catch {
    // Server is still starting.
  }

  await Bun.sleep(200);
}

let browser: Bun.Subprocess | undefined;

let browserStdout = Promise.resolve("");

let browserStderr = Promise.resolve("");

try {
  if (browserTarget.kind === "chromium") {
    browser = Bun.spawn(
      [
        browserTarget.executable,
        `--user-data-dir=${profileDirectory}`,
        "--no-first-run",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        `--app=${url}`,
      ],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    browserStdout = readPipe(browser.stdout);
    browserStderr = readPipe(browser.stderr);
  } else {
    const launched = Bun.spawn(
      [
        "open",
        "-na",
        browserTarget.appName,
        url,
      ],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    browserStdout = readPipe(launched.stdout);
    browserStderr = readPipe(launched.stderr);

    if ((await launched.exited) !== 0) {
      throw new Error(
        `Could not launch ${browserTarget.name}.`,
      );
    }
  }

  console.log(
    `Launched ${browserTarget.name}: ${url}`,
  );

  const timeoutMs = Number.parseInt(
    process.env.BGCUT_BROWSER_BENCHMARK_TIMEOUT_MS ??
      "900000",
    10,
  );

  const completionDeadline =
    Date.now() + timeoutMs;

  let completed = false;

  while (Date.now() < completionDeadline) {
    const failurePath = join(
      outputRoot,
      "browser-failure.json",
    );

    if (await Bun.file(failurePath).exists()) {
      throw new Error(
        `Browser benchmark failed.\n${await readFile(
          failurePath,
          "utf8",
        )}`,
      );
    }

    const complete =
      await Promise.all([
        "browser-timings.json",
        "pixel-comparison.json",
        "cpu/quality.json",
        "gpu/quality.json",
      ].map((path) =>
        Bun.file(
          join(outputRoot, path),
        ).exists()
      ));

    if (complete.every(Boolean)) {
      completed = true;

      console.log(
        "Browser composite benchmark completed.",
      );

      break;
    }

    if (
      browser !== undefined &&
      browser.exitCode !== null
    ) {
      throw new Error(
        `${browserTarget.name} exited before completion.`,
      );
    }

    if (server.exitCode !== null) {
      throw new Error(
        "Benchmark server exited before completion.",
      );
    }

    await Bun.sleep(500);
  }

  if (!completed) {
    throw new Error(
      `Browser composite benchmark timed out after ${timeoutMs} ms.`,
    );
  }
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
    rm(
      profileDirectory,
      { recursive: true, force: true },
    ),
  ]);
}
