import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  join,
  resolve,
} from "node:path";

const usage =
  "Usage: bun run benchmark:browser-output-location:diagnostic:e2e -- <manifest.json> <output-dir> <model.onnx> [measured-runs] [timeout-ms] [port] [case-id]";

const args =
  process.argv.slice(2);

if (
  args.length < 3
) {
  throw new Error(usage);
}

if (
  process.platform !==
  "darwin"
) {
  throw new Error(
    "The Safari CPU-output diagnostic requires macOS.",
  );
}

const outputRoot =
  resolve(
    args[1],
  );

const measuredRuns =
  Number.parseInt(
    args[3] ?? "3",
    10,
  );

const timeoutMs =
  Number.parseInt(
    args[4] ?? "60000",
    10,
  );

const port =
  args[5] ?? "4188";

const url =
  `http://127.0.0.1:${port}/`;

const readPipe = (
  pipe:
    | number
    | ReadableStream<Uint8Array>
    | undefined,
): Promise<string> =>
  pipe instanceof
    ReadableStream
    ? new Response(
        pipe,
      ).text()
    : Promise.resolve("");

const appExists = async (
  appName: string,
): Promise<boolean> => {
  const process =
    Bun.spawn(
      [
        "open",
        "-Ra",
        appName,
      ],
      {
        stdin:
          "ignore",
        stdout:
          "ignore",
        stderr:
          "ignore",
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
    await appExists(
      appName,
    )
  ) {
    browserApp =
      appName;

    break;
  }
}

if (
  browserApp ===
  undefined
) {
  throw new Error(
    "Safari was not found.",
  );
}

await mkdir(
  outputRoot,
  {
    recursive: true,
  },
);

for (
  const name of [
    "browser-output-location-diagnostic.json",
    "browser-failure.json",
    "latest-progress.json",
  ]
) {
  await rm(
    join(
      outputRoot,
      name,
    ),
    {
      force: true,
    },
  );
}

const server =
  Bun.spawn(
    [
      "bun",
      "run",
      "scripts/benchmark/browser-output-location-diagnostic-server.ts",
      ...args,
    ],
    {
      cwd: resolve(
        import.meta.dir,
        "../..",
      ),
      stdin:
        "ignore",
      stdout:
        "pipe",
      stderr:
        "pipe",
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
  Date.now() +
  20_000;

let serverReady =
  false;

while (
  Date.now() <
  startDeadline
) {
  try {
    const response =
      await fetch(url);

    if (
      response.ok
    ) {
      serverReady =
        true;

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
      `CPU-output diagnostic server exited with code ${server.exitCode}.`,
    );
  }

  await Bun.sleep(
    200,
  );
}

if (!serverReady) {
  server.kill();

  throw new Error(
    "CPU-output diagnostic server did not become ready.",
  );
}

let browserStdout =
  Promise.resolve("");

let browserStderr =
  Promise.resolve("");

try {
  const launched =
    Bun.spawn(
      [
        "open",
        "-na",
        browserApp,
        url,
      ],
      {
        stdin:
          "ignore",
        stdout:
          "pipe",
        stderr:
          "pipe",
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
    Date.now() +
    timeoutMs *
      (measuredRuns + 1) +
    60_000;

  let completed =
    false;

  while (
    Date.now() <
    deadline
  ) {
    const failurePath =
      join(
        outputRoot,
        "browser-failure.json",
      );

    if (
      await Bun.file(
        failurePath,
      ).exists()
    ) {
      throw new Error(
        `CPU-output diagnostic failed.\n${await readFile(
          failurePath,
          "utf8",
        )}`,
      );
    }

    const reportPath =
      join(
        outputRoot,
        "browser-output-location-diagnostic.json",
      );

    if (
      await Bun.file(
        reportPath,
      ).exists()
    ) {
      completed =
        true;

      console.log(
        "CPU-output diagnostic passed.",
      );

      break;
    }

    await Bun.sleep(
      250,
    );
  }

  if (!completed) {
    const progressPath =
      join(
        outputRoot,
        "latest-progress.json",
      );

    const progress =
      await Bun.file(
        progressPath,
      ).exists()
        ? await readFile(
            progressPath,
            "utf8",
          )
        : "No progress marker was persisted.";

    throw new Error(
      `CPU-output diagnostic exceeded its launcher deadline. Last progress:\n${progress}`,
    );
  }
} finally {
  server.kill();

  const [
    capturedServerStdout,
    capturedServerStderr,
    capturedBrowserStdout,
    capturedBrowserStderr,
  ] =
    await Promise.all([
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
