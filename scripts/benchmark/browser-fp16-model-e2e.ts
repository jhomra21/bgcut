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

const ReportSchema = Schema.Struct({
  aggregate: Schema.Struct({
    inferenceChangePercent:
      Schema.Number,
    totalChangePercent:
      Schema.Number,
  }),
  quality: Schema.Struct({
    fp32: Schema.Struct({
      maeMedian: Schema.Number,
      mseMedian: Schema.Number,
      iouMedian: Schema.Number,
      f1Median: Schema.Number,
    }),
    fp16: Schema.Struct({
      maeMedian: Schema.Number,
      mseMedian: Schema.Number,
      iouMedian: Schema.Number,
      f1Median: Schema.Number,
    }),
  }),
});

const usage =
  "Usage: bun run benchmark:browser-fp16-model:e2e -- <manifest.json> <output-dir> <fp32-model.onnx> <fp16-model.onnx> [runs] [timeout-ms] [port] [case-id]";

const args =
  process.argv.slice(
    2,
  );

if (
  args.length < 4
) {
  throw new Error(
    usage,
  );
}

if (
  process.platform !==
  "darwin"
) {
  throw new Error(
    "The Safari FP16 model benchmark requires macOS.",
  );
}

const outputRoot =
  resolve(
    args[1],
  );

const runs =
  Number.parseInt(
    args[4] ?? "3",
    10,
  );

const timeoutMs =
  Number.parseInt(
    args[5] ?? "60000",
    10,
  );

const port =
  args[6] ??
  "4184";

const url =
  `http://127.0.0.1:${port}/?block=0`;

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
    : Promise.resolve(
        "",
      );

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
  ) ===
    0;
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
    "browser-fp16-model.json",
    "browser-failure.json",
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
      "scripts/benchmark/browser-fp16-model-server.ts",
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
      `FP16 benchmark server exited with code ${server.exitCode}.`,
    );
  }

  await Bun.sleep(
    200,
  );
}

if (
  !serverReady
) {
  server.kill();

  throw new Error(
    "FP16 benchmark server did not become ready.",
  );
}

let browserStdout =
  Promise.resolve(
    "",
  );

let browserStderr =
  Promise.resolve(
    "",
  );

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
    (
      await launched.exited
    ) !==
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
      (runs + 1) *
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
        `FP16 model benchmark failed.\n${await readFile(
          failurePath,
          "utf8",
        )}`,
      );
    }

    const reportPath =
      join(
        outputRoot,
        "browser-fp16-model.json",
      );

    if (
      await Bun.file(
        reportPath,
      ).exists()
    ) {
      const report =
        Schema.decodeUnknownSync(
          ReportSchema,
        )(
          JSON.parse(
            await readFile(
              reportPath,
              "utf8",
            ),
          ),
        );

      console.log(
        `FP16 model benchmark completed. Inference change ${report.aggregate.inferenceChangePercent.toFixed(
          1,
        )}%, total change ${report.aggregate.totalChangePercent.toFixed(
          1,
        )}%.`,
      );

      console.log(
        `Quality F1: fp32 ${report.quality.fp32.f1Median.toFixed(
          6,
        )}, fp16 ${report.quality.fp16.f1Median.toFixed(
          6,
        )}.`,
      );

      completed =
        true;

      break;
    }

    await Bun.sleep(
      250,
    );
  }

  if (
    !completed
  ) {
    throw new Error(
      "FP16 model benchmark exceeded its launcher deadline.",
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
