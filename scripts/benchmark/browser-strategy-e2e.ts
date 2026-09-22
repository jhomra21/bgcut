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

const usage =
  "Usage: bun run benchmark:browser-strategy:e2e -- <manifest.json> <output-dir> <model.onnx> [runs-per-strategy] [port]";

const args = process.argv.slice(2);

if (args.length < 3) {
  throw new Error(usage);
}

const outputRoot = resolve(args[1]);

const port = args[4] ?? "4184";

const url = `http://127.0.0.1:${port}/`;

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
    const configured =
      process.env.BGCUT_BROWSER_PATH ??
      process.env.BGCUT_CHROME_PATH;

    const candidates = [
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
        name: "Chromium",
        executable:
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
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
    ];

    for (const candidate of candidates) {
      try {
        await access(candidate.executable);

        return {
          kind: "chromium",
          ...candidate,
        };
      } catch {
        // Try the next browser.
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

await mkdir(
  outputRoot,
  { recursive: true },
);

for (const name of [
  "browser-strategies.json",
  "browser-failure.json",
  "pixel-comparison.json",
]) {
  await rm(
    join(outputRoot, name),
    { force: true },
  );
}

const browserTarget = await findBrowser();

const profileDirectory = await mkdtemp(
  join(tmpdir(), "bgcut-strategy-"),
);

const server = Bun.spawn(
  [
    "bun",
    "run",
    "scripts/benchmark/browser-strategy-server.ts",
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

const startDeadline = Date.now() + 20_000;

while (Date.now() < startDeadline) {
  try {
    const response = await fetch(url);

    if (response.ok) {
      break;
    }
  } catch {
    // Server is still starting.
  }

  if (server.exitCode !== null) {
    throw new Error(
      `Strategy server exited with code ${server.exitCode}.`,
    );
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

  const deadline = Date.now() + 600_000;

  while (Date.now() < deadline) {
    const failurePath = join(
      outputRoot,
      "browser-failure.json",
    );

    if (await Bun.file(failurePath).exists()) {
      throw new Error(
        `Strategy benchmark failed.\n${await readFile(
          failurePath,
          "utf8",
        )}`,
      );
    }

    const reportPath = join(
      outputRoot,
      "browser-strategies.json",
    );

    const comparisonPath = join(
      outputRoot,
      "pixel-comparison.json",
    );

    if (
      await Bun.file(reportPath).exists() &&
      await Bun.file(comparisonPath).exists()
    ) {
      console.log(
        "Strategy benchmark passed.",
      );

      break;
    }

    await Bun.sleep(250);
  }

  if (
    !(await Bun.file(
      join(
        outputRoot,
        "browser-strategies.json",
      ),
    ).exists())
  ) {
    throw new Error(
      "Strategy benchmark timed out before completion.",
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
      join(
        outputRoot,
        "server-stdout.log",
      ),
      capturedServerStdout,
    ),
    writeFile(
      join(
        outputRoot,
        "server-stderr.log",
      ),
      capturedServerStderr,
    ),
    writeFile(
      join(
        outputRoot,
        "browser-stdout.log",
      ),
      capturedBrowserStdout,
    ),
    writeFile(
      join(
        outputRoot,
        "browser-stderr.log",
      ),
      capturedBrowserStderr,
    ),
    rm(
      profileDirectory,
      {
        recursive: true,
        force: true,
      },
    ),
  ]);
}
