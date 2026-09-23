import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const usage =
  "Usage: bun run benchmark:browser-output-location:e2e -- <manifest.json> <output-dir> <model.onnx> [warm-runs-per-mode] [port]";

const args = process.argv.slice(2);

if (args.length < 3) {
  throw new Error(usage);
}

if (process.platform !== "darwin") {
  throw new Error(
    "The Safari output-location benchmark requires macOS.",
  );
}

const outputRoot = resolve(
  args[1],
);

const port =
  args[4] ?? "4186";

const url =
  `http://127.0.0.1:${port}/`;

const readPipe = (
  pipe:
    | number
    | ReadableStream<Uint8Array>
    | undefined,
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

  return (
    await process.exited
  ) === 0;
};

let browserApp:
  | string
  | undefined;

for (
  const appName of [
    "Safari Technology Preview",
    "Safari",
  ]
) {
  if (
    await appExists(appName)
  ) {
    browserApp = appName;

    break;
  }
}

if (
  browserApp === undefined
) {
  throw new Error(
    "Safari was not found.",
  );
}

await mkdir(
  outputRoot,
  { recursive: true },
);

for (
  const name of [
    "browser-output-location.json",
    "browser-failure.json",
    "pixel-comparison.json",
  ]
) {
  await rm(
    join(
      outputRoot,
      name,
    ),
    { force: true },
  );
}

const server = Bun.spawn(
  [
    "bun",
    "run",
    "scripts/benchmark/browser-output-location-server.ts",
    ...args,
  ],
  {
    cwd: resolve(
      import.meta.dir,
      "../..",
    ),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  },
);

const serverStdout =
  readPipe(
    server.stdout,
  );

const serverStderr =
  readPipe(
    server.stderr,
  );

const startDeadline =
  Date.now() + 20_000;

let serverReady = false;

while (
  Date.now() <
  startDeadline
) {
  try {
    const response =
      await fetch(url);

    if (response.ok) {
      serverReady = true;

      break;
    }
  } catch {
    // The server is still starting.
  }

  if (
    server.exitCode !==
    null
  ) {
    throw new Error(
      `Output-location server exited with code ${server.exitCode}.`,
    );
  }

  await Bun.sleep(200);
}

if (!serverReady) {
  server.kill();

  throw new Error(
    "Output-location server did not become ready.",
  );
}

let browserStdout =
  Promise.resolve("");

let browserStderr =
  Promise.resolve("");

try {
  const launched = Bun.spawn(
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

  browserStdout =
    readPipe(
      launched.stdout,
    );

  browserStderr =
    readPipe(
      launched.stderr,
    );

  if (
    (await launched.exited) !==
    0
  ) {
    throw new Error(
      `Could not launch ${browserApp}.`,
    );
  }

  console.log(
    `Launched ${browserApp}: ${url}`,
  );

  const deadline =
    Date.now() + 600_000;

  let completed = false;

  while (
    Date.now() <
    deadline
  ) {
    const failurePath = join(
      outputRoot,
      "browser-failure.json",
    );

    if (
      await Bun.file(
        failurePath,
      ).exists()
    ) {
      throw new Error(
        `Output-location benchmark failed.\n${await readFile(
          failurePath,
          "utf8",
        )}`,
      );
    }

    const reportPath = join(
      outputRoot,
      "browser-output-location.json",
    );

    const comparisonPath = join(
      outputRoot,
      "pixel-comparison.json",
    );

    if (
      await Bun.file(
        reportPath,
      ).exists() &&
      await Bun.file(
        comparisonPath,
      ).exists()
    ) {
      completed = true;

      console.log(
        "Output-location benchmark passed.",
      );

      break;
    }

    await Bun.sleep(250);
  }

  if (!completed) {
    throw new Error(
      "Output-location benchmark timed out before completion.",
    );
  }
} finally {
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
  ]);
}
