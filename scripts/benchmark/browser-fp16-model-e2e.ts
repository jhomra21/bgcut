import { Schema } from "effect";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
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
  bySequence: Schema.Struct({
    "fp32-first": Schema.Struct({
      inferenceChangePercent:
        Schema.Number,
      totalChangePercent:
        Schema.Number,
    }),
    "fp16-first": Schema.Struct({
      inferenceChangePercent:
        Schema.Number,
      totalChangePercent:
        Schema.Number,
    }),
  }),
  byPosition: Schema.Struct({
    first: Schema.Struct({
      inferenceChangePercent:
        Schema.Number,
      totalChangePercent:
        Schema.Number,
    }),
    second: Schema.Struct({
      inferenceChangePercent:
        Schema.Number,
      totalChangePercent:
        Schema.Number,
    }),
  }),
  trials: Schema.Array(
    Schema.Struct({
      trial: Schema.Number,
      sequence: Schema.String,
      comparison: Schema.Struct({
        inferenceChangePercent:
          Schema.Number,
        totalChangePercent:
          Schema.Number,
      }),
    }),
  ),
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

type ServerHandle = {
  readonly child:
    ReturnType<
      typeof Bun.spawn
    >;
  readonly stdout:
    Promise<string>;
  readonly stderr:
    Promise<string>;
};

type BrowserLaunch = {
  readonly pids:
    readonly number[];
  readonly stdout:
    string;
  readonly stderr:
    string;
};

type LaunchRecord = {
  readonly phase:
    "prewarm" |
    "measured";
  readonly block: number;
  readonly browserPids:
    readonly number[];
};

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

const manifestPath =
  args[0];

const outputRoot =
  resolve(
    args[1],
  );

const fp32ModelPath =
  args[2];

const fp16ModelPath =
  args[3];

const runs =
  Number.parseInt(
    args[4] ??
      "3",
    10,
  );

const timeoutMs =
  Number.parseInt(
    args[5] ??
      "60000",
    10,
  );

const port =
  args[6] ??
  "4184";

const caseId =
  args[7] ??
  "cat-in-sink";

const baseUrl =
  `http://127.0.0.1:${port}/`;

const cooldownMs =
  5_000;

const prewarmBlocks =
  [
    0,
    2,
    2,
    0,
  ] as const;

const measuredBlocks =
  [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
  ] as const;

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
  const child =
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
    await child.exited
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

const browserProcessIds =
  async (): Promise<
    ReadonlySet<number>
  > => {
    const child =
      Bun.spawn(
        [
          "ps",
          "-axo",
          "pid=,comm=",
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

    const [
      stdout,
      stderr,
      exitCode,
    ] =
      await Promise.all([
        readPipe(
          child.stdout,
        ),
        readPipe(
          child.stderr,
        ),
        child.exited,
      ]);

    if (
      exitCode !==
      0
    ) {
      throw new Error(
        `Could not inspect Safari processes.\n${stderr || stdout}`,
      );
    }

    const ids =
      new Set<number>();

    for (
      const line of
      stdout.split(
        "\n",
      )
    ) {
      const match =
        line.match(
          /^\s*(\d+)\s+(.+)$/u,
        );

      if (
        match ===
        null
      ) {
        continue;
      }

      const executable =
        basename(
          match[2].trim(),
        );

      if (
        executable !==
        browserApp
      ) {
        continue;
      }

      ids.add(
        Number.parseInt(
          match[1],
          10,
        ),
      );
    }

    return ids;
  };

const launchIsolatedBrowser =
  async (
    url: string,
  ): Promise<BrowserLaunch> => {
    const before =
      await browserProcessIds();

    const child =
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

    const [
      stdout,
      stderr,
      exitCode,
    ] =
      await Promise.all([
        readPipe(
          child.stdout,
        ),
        readPipe(
          child.stderr,
        ),
        child.exited,
      ]);

    if (
      exitCode !==
      0
    ) {
      throw new Error(
        `Could not launch ${browserApp}.\n${stderr || stdout}`,
      );
    }

    const deadline =
      Date.now() +
      10_000;

    while (
      Date.now() <
      deadline
    ) {
      const after =
        await browserProcessIds();

      const added =
        [...after].filter(
          (pid) =>
            !before.has(
              pid,
            ),
        );

      if (
        added.length >
        0
      ) {
        return {
          pids:
            added,
          stdout,
          stderr,
        };
      }

      await Bun.sleep(
        100,
      );
    }

    throw new Error(
      `Could not identify the newly launched ${browserApp} process.`,
    );
  };

const signalProcesses =
  async (
    pids:
      readonly number[],
    signal:
      "-TERM" |
      "-KILL",
  ): Promise<void> => {
    await Promise.all(
      pids.map(
        async (pid) => {
          const child =
            Bun.spawn(
              [
                "kill",
                signal,
                String(
                  pid,
                ),
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

          await child.exited;
        },
      ),
    );
  };

const terminateBrowser =
  async (
    pids:
      readonly number[],
  ): Promise<void> => {
    if (
      pids.length ===
      0
    ) {
      return;
    }

    await signalProcesses(
      pids,
      "-TERM",
    );

    const deadline =
      Date.now() +
      5_000;

    while (
      Date.now() <
      deadline
    ) {
      const active =
        await browserProcessIds();

      if (
        pids.every(
          (pid) =>
            !active.has(
              pid,
            ),
        )
      ) {
        return;
      }

      await Bun.sleep(
        100,
      );
    }

    await signalProcesses(
      pids,
      "-KILL",
    );
  };

const startServer =
  async (
    serverOutputRoot: string,
  ): Promise<ServerHandle> => {
    const child =
      Bun.spawn(
        [
          "bun",
          "run",
          "scripts/benchmark/browser-fp16-model-server.ts",
          manifestPath,
          serverOutputRoot,
          fp32ModelPath,
          fp16ModelPath,
          String(
            runs,
          ),
          String(
            timeoutMs,
          ),
          port,
          caseId,
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

    const handle:
      ServerHandle = {
        child,
        stdout:
          readPipe(
            child.stdout,
          ),
        stderr:
          readPipe(
            child.stderr,
          ),
      };

    const deadline =
      Date.now() +
      20_000;

    while (
      Date.now() <
      deadline
    ) {
      try {
        const response =
          await fetch(
            baseUrl,
          );

        if (
          response.ok
        ) {
          return handle;
        }
      } catch {
        // The server is still starting.
      }

      if (
        child.exitCode !==
        null
      ) {
        const [
          stdout,
          stderr,
        ] =
          await Promise.all([
            handle.stdout,
            handle.stderr,
          ]);

        throw new Error(
          `FP16 benchmark server exited with code ${child.exitCode}.\n${stderr || stdout}`,
        );
      }

      await Bun.sleep(
        200,
      );
    }

    child.kill();

    throw new Error(
      "FP16 benchmark server did not become ready.",
    );
  };

const stopServer =
  async (
    handle:
      ServerHandle,
    serverOutputRoot:
      string,
  ): Promise<void> => {
    handle.child.kill();

    const [
      stdout,
      stderr,
    ] =
      await Promise.all([
        handle.stdout,
        handle.stderr,
      ]);

    await Promise.all([
      writeFile(
        join(
          serverOutputRoot,
          "server-stdout.log",
        ),
        stdout,
      ),
      writeFile(
        join(
          serverOutputRoot,
          "server-stderr.log",
        ),
        stderr,
      ),
    ]);
  };

const waitForArtifact =
  async (
    serverOutputRoot:
      string,
    targetPath:
      string,
    deadlineMs:
      number,
  ): Promise<void> => {
    const failurePath =
      join(
        serverOutputRoot,
        "browser-failure.json",
      );

    const deadline =
      Date.now() +
      deadlineMs;

    while (
      Date.now() <
      deadline
    ) {
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

      if (
        await Bun.file(
          targetPath,
        ).exists()
      ) {
        return;
      }

      await Bun.sleep(
        200,
      );
    }

    throw new Error(
      `Timed out waiting for ${targetPath}.`,
    );
  };

const runIsolatedPage =
  async (
    serverOutputRoot:
      string,
    block:
      number,
    query:
      string,
    expectedPath:
      string,
    timeout:
      number,
  ): Promise<BrowserLaunch> => {
    await rm(
      join(
        serverOutputRoot,
        "browser-failure.json",
      ),
      {
        force:
          true,
      },
    );

    await rm(
      expectedPath,
      {
        force:
          true,
      },
    );

    const launch =
      await launchIsolatedBrowser(
        `${baseUrl}?${query}`,
      );

    try {
      console.log(
        `Launched isolated ${browserApp} process ${launch.pids.join(
          ", ",
        )} for block ${block}.`,
      );

      await waitForArtifact(
        serverOutputRoot,
        expectedPath,
        timeout,
      );

      await Bun.sleep(
        250,
      );

      return launch;
    } finally {
      await terminateBrowser(
        launch.pids,
      );
    }
  };

await rm(
  outputRoot,
  {
    recursive:
      true,
    force:
      true,
  },
);

await mkdir(
  outputRoot,
  {
    recursive:
      true,
  },
);

const launchRecords:
  LaunchRecord[] = [];

const prewarmRoot =
  join(
    outputRoot,
    "prewarm",
  );

await mkdir(
  prewarmRoot,
  {
    recursive:
      true,
  },
);

let prewarmServer:
  | ServerHandle
  | undefined;

try {
  prewarmServer =
    await startServer(
      prewarmRoot,
    );

  for (
    const block of
    prewarmBlocks
  ) {
    const primePath =
      join(
        prewarmRoot,
        "runs",
        `block-${block}`,
        "prime.json",
      );

    const launch =
      await runIsolatedPage(
        prewarmRoot,
        block,
        `block=${block}&primeOnly=1&single=1`,
        primePath,
        timeoutMs +
          30_000,
      );

    launchRecords.push({
      phase:
        "prewarm",
      block,
      browserPids:
        launch.pids,
    });

    await Bun.sleep(
      1_000,
    );
  }
} finally {
  if (
    prewarmServer !==
    undefined
  ) {
    await stopServer(
      prewarmServer,
      prewarmRoot,
    );
  }
}

console.log(
  `Both model pipelines prewarmed. Cooling down for ${cooldownMs} ms before measurement.`,
);

await Bun.sleep(
  cooldownMs,
);

let measuredServer:
  | ServerHandle
  | undefined;

try {
  measuredServer =
    await startServer(
      outputRoot,
    );

  for (
    const block of
    measuredBlocks
  ) {
    const blockPath =
      join(
        outputRoot,
        "blocks",
        `block-${block}.json`,
      );

    const launch =
      await runIsolatedPage(
        outputRoot,
        block,
        `block=${block}&single=1`,
        blockPath,
        timeoutMs *
          (
            runs +
            1
          ) +
          30_000,
      );

    launchRecords.push({
      phase:
        "measured",
      block,
      browserPids:
        launch.pids,
    });

    await Bun.sleep(
      1_500,
    );
  }

  const reportPath =
    join(
      outputRoot,
      "browser-fp16-model.json",
    );

  await waitForArtifact(
    outputRoot,
    reportPath,
    60_000,
  );

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

  await writeFile(
    join(
      outputRoot,
      "process-isolation.json",
    ),
    `${JSON.stringify(
      {
        schemaVersion:
          1,
        browserApp,
        prewarmSchedule:
          prewarmBlocks,
        measuredSchedule:
          measuredBlocks,
        cooldownMs,
        launches:
          launchRecords,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `FP16 model benchmark completed. Aggregate inference change ${report.aggregate.inferenceChangePercent.toFixed(
      1,
    )}%, total change ${report.aggregate.totalChangePercent.toFixed(
      1,
    )}%.`,
  );

  console.log(
    `FP32-first total change ${report.bySequence["fp32-first"].totalChangePercent.toFixed(
      1,
    )}%; FP16-first total change ${report.bySequence["fp16-first"].totalChangePercent.toFixed(
      1,
    )}%.`,
  );

  console.log(
    `First-position total change ${report.byPosition.first.totalChangePercent.toFixed(
      1,
    )}%; second-position total change ${report.byPosition.second.totalChangePercent.toFixed(
      1,
    )}%.`,
  );

  for (
    const trial of
    report.trials
  ) {
    console.log(
      `Trial ${trial.trial} (${trial.sequence}): inference ${trial.comparison.inferenceChangePercent.toFixed(
        1,
      )}%, total ${trial.comparison.totalChangePercent.toFixed(
        1,
      )}%.`,
    );
  }

  console.log(
    `Quality F1: fp32 ${report.quality.fp32.f1Median.toFixed(
      6,
    )}, fp16 ${report.quality.fp16.f1Median.toFixed(
      6,
    )}.`,
  );
} finally {
  if (
    measuredServer !==
    undefined
  ) {
    await stopServer(
      measuredServer,
      outputRoot,
    );
  }
}
