import { Schema } from "effect";
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

const ComparisonSchema = Schema.Struct({
  mode: Schema.Union(
    Schema.Literal(8),
    Schema.Literal(32),
    Schema.Literal(64),
  ),
  differingValues: Schema.Number,
});

const PixelComparisonSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  baseline: Schema.Literal(
    "default",
  ),
  comparisons: Schema.Array(
    ComparisonSchema,
  ),
});

const usage =
  "Usage: bun run benchmark:browser-dispatch-batching:e2e -- <manifest.json> <output-dir> <model.onnx> [measured-runs] [timeout-ms] [port] [case-id]";

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
    "The Safari dispatch-batching benchmark requires macOS.",
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
  args[5] ?? "4184";

const url =
  `http://127.0.0.1:${port}/?mode=default`;

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
    "browser-dispatch-batching.json",
    "browser-failure.json",
    "pixel-comparison.json",
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
      "scripts/benchmark/browser-dispatch-batching-server.ts",
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

const baseUrl =
  `http://127.0.0.1:${port}/`;

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
        baseUrl,
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
      `Dispatch-batching benchmark server exited with code ${server.exitCode}.`,
    );
  }

  await Bun.sleep(
    200,
  );
}

if (!serverReady) {
  server.kill();

  throw new Error(
    "Dispatch-batching benchmark server did not become ready.",
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
      (measuredRuns + 1) *
      4 +
    120_000;

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
        `Dispatch-batching benchmark failed.\n${await readFile(
          failurePath,
          "utf8",
        )}`,
      );
    }

    const reportPath =
      join(
        outputRoot,
        "browser-dispatch-batching.json",
      );

    const comparisonPath =
      join(
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
      const comparison =
        Schema.decodeUnknownSync(
          PixelComparisonSchema,
        )(
          JSON.parse(
            await readFile(
              comparisonPath,
              "utf8",
            ),
          ),
        );

      const changed =
        comparison.comparisons.filter(
          (candidate) =>
            candidate.differingValues !==
            0,
        );

      if (
        changed.length > 0
      ) {
        throw new Error(
          `Dispatch-batching parity failed for modes: ${changed
            .map(
              (candidate) =>
                String(
                  candidate.mode,
                ),
            )
            .join(", ")}.`,
        );
      }

      completed =
        true;

      console.log(
        "Dispatch-batching benchmark passed with byte-identical candidate outputs.",
      );

      break;
    }

    await Bun.sleep(
      250,
    );
  }

  if (!completed) {
    throw new Error(
      "Dispatch-batching benchmark exceeded its launcher deadline.",
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
