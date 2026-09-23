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
  "Usage: bun run benchmark:browser-source-repeatability:e2e -- <manifest.json> <output-dir> [runs] [port] [case-id]";

const args =
  process.argv.slice(2);

if (
  args.length < 2
) {
  throw new Error(usage);
}

if (
  process.platform !==
  "darwin"
) {
  throw new Error(
    "The Safari source-repeatability benchmark requires macOS.",
  );
}

const outputRoot =
  resolve(
    args[1],
  );

const runs =
  Number.parseInt(
    args[2] ?? "3",
    10,
  );

const port =
  args[3] ?? "4184";

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

await rm(
  join(
    outputRoot,
    "browser-source-repeatability.json",
  ),
  {
    force: true,
  },
);

const server =
  Bun.spawn(
    [
      "bun",
      "run",
      "scripts/benchmark/browser-source-repeatability-server.ts",
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
      await fetch(
        url,
      );

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
      `Source-repeatability server exited with code ${server.exitCode}.`,
    );
  }

  await Bun.sleep(
    200,
  );
}

if (!serverReady) {
  server.kill();

  throw new Error(
    "Source-repeatability server did not become ready.",
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
    Math.max(
      120_000,
      runs *
        3 *
        15_000,
    );

  let completed =
    false;

  while (
    Date.now() <
    deadline
  ) {
    const reportPath =
      join(
        outputRoot,
        "browser-source-repeatability.json",
      );

    if (
      await Bun.file(
        reportPath,
      ).exists()
    ) {
      completed =
        true;

      console.log(
        "Source-repeatability benchmark passed.",
      );

      break;
    }

    await Bun.sleep(
      250,
    );
  }

  if (!completed) {
    throw new Error(
      "Source-repeatability benchmark exceeded its launcher deadline.",
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
