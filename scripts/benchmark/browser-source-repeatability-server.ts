import { Schema } from "effect";
import sharp from "sharp";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const BenchmarkManifestSchema = Schema.Struct({
  cases: Schema.Array(
    BenchmarkCaseSchema,
  ),
});

const StrategySchema = Schema.Literal(
  "current",
  "bitmap-no-color-conversion",
  "html-image-srgb-canvas",
);

const RunRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  strategy: StrategySchema,
  run: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  elapsedMs: Schema.Number,
});

const StrategyReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  userAgent: Schema.String,
  caseId: Schema.String,
  strategy: StrategySchema,
  runs: Schema.Array(
    RunRecordSchema,
  ),
});

type Strategy =
  Schema.Schema.Type<
    typeof StrategySchema
  >;

type StrategyReport =
  Schema.Schema.Type<
    typeof StrategyReportSchema
  >;

type ChannelStats = {
  readonly differingValues: number;
  readonly maxAbsoluteByteDifference: number;
  readonly meanAbsoluteByteDifference: number;
};

type Comparison = {
  readonly left: string;
  readonly right: string;
  readonly values: number;
  readonly pixels: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
  readonly maxAbsoluteByteDifference: number;
  readonly meanAbsoluteByteDifference: number;
  readonly channels: {
    readonly r: ChannelStats;
    readonly g: ChannelStats;
    readonly b: ChannelStats;
    readonly a: ChannelStats;
  };
};

type FinalReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly caseId: string;
  readonly runs: number;
  readonly reports: readonly StrategyReport[];
  readonly withinStrategy: Readonly<
    Record<
      Strategy,
      readonly Comparison[]
    >
  >;
  readonly versusStableCurrent: Readonly<
    Record<
      Exclude<
        Strategy,
        "current"
      >,
      readonly Comparison[]
    >
  >;
};

const usage =
  "Usage: bun run benchmark:browser-source-repeatability -- <manifest.json> <output-dir> [runs] [port] [case-id]";

const [
  manifestArgument,
  outputArgument,
  runsArgument = "3",
  portArgument = "4184",
  caseId = "dog-blind-dog",
] = process.argv.slice(2);

if (
  manifestArgument === undefined ||
  outputArgument === undefined
) {
  throw new Error(usage);
}

const manifestPath =
  resolve(
    manifestArgument,
  );

const manifestRoot =
  dirname(
    manifestPath,
  );

const outputRoot =
  resolve(
    outputArgument,
  );

const outputDirectory =
  join(
    outputRoot,
    "outputs",
  );

const strategyDirectory =
  join(
    outputRoot,
    "strategies",
  );

const runs =
  Number.parseInt(
    runsArgument,
    10,
  );

if (
  !Number.isInteger(
    runs,
  ) ||
  runs < 3
) {
  throw new Error(
    `Runs must be an integer >= 3, received "${runsArgument}".`,
  );
}

const port =
  Number.parseInt(
    portArgument,
    10,
  );

if (
  !Number.isInteger(
    port,
  ) ||
  port < 1
) {
  throw new Error(
    `Port must be a positive integer, received "${portArgument}".`,
  );
}

const manifest =
  Schema.decodeUnknownSync(
    BenchmarkManifestSchema,
  )(
    JSON.parse(
      await readFile(
        manifestPath,
        "utf8",
      ),
    ),
  );

const benchmarkCase =
  manifest.cases.find(
    (candidate) =>
      candidate.id ===
      caseId,
  );

if (
  benchmarkCase === undefined
) {
  throw new Error(
    `Benchmark case "${caseId}" was not found in the manifest.`,
  );
}

const strategies:
  readonly Strategy[] = [
    "current",
    "bitmap-no-color-conversion",
    "html-image-srgb-canvas",
  ];

await Promise.all([
  mkdir(
    outputRoot,
    {
      recursive: true,
    },
  ),
  mkdir(
    strategyDirectory,
    {
      recursive: true,
    },
  ),
  ...strategies.map(
    (strategy) =>
      mkdir(
        join(
          outputDirectory,
          strategy,
        ),
        {
          recursive: true,
        },
      ),
  ),
]);

const build =
  await Bun.build({
    entrypoints: [
      join(
        import.meta.dir,
        "browser-source-repeatability-client.ts",
      ),
    ],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
  });

if (
  !build.success
) {
  throw new Error(
    `Could not build source-repeatability client.\n${build.logs
      .map(
        (log) =>
          log.message,
      )
      .join("\n")}`,
  );
}

const clientOutput =
  build.outputs.at(0);

if (
  clientOutput === undefined
) {
  throw new Error(
    "Source-repeatability client produced no bundle.",
  );
}

const clientSource =
  await clientOutput.text();

if (
  process.env
    .BGCUT_BROWSER_SOURCE_REPEATABILITY_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser source-repeatability bundle check passed.",
  );

  process.exit(0);
}

const reports =
  new Map<
    Strategy,
    StrategyReport
  >();

const outputPath = (
  strategy: Strategy,
  run: number,
): string =>
  join(
    outputDirectory,
    strategy,
    `run-${run}.png`,
  );

const readRaster = async (
  strategy: Strategy,
  run: number,
) => {
  const result =
    await sharp(
      outputPath(
        strategy,
        run,
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject:
          true,
      });

  if (
    result.info.channels !==
    4
  ) {
    throw new Error(
      `Expected RGBA pixels for ${strategy} run ${run}.`,
    );
  }

  return {
    width:
      result.info.width,
    height:
      result.info.height,
    data:
      result.data,
  };
};

const compare = async (
  leftStrategy: Strategy,
  leftRun: number,
  rightStrategy: Strategy,
  rightRun: number,
): Promise<Comparison> => {
  const [
    left,
    right,
  ] =
    await Promise.all([
      readRaster(
        leftStrategy,
        leftRun,
      ),
      readRaster(
        rightStrategy,
        rightRun,
      ),
    ]);

  if (
    left.width !==
      right.width ||
    left.height !==
      right.height ||
    left.data.length !==
      right.data.length
  ) {
    throw new Error(
      `Dimensions differ between ${leftStrategy} run ${leftRun} and ${rightStrategy} run ${rightRun}.`,
    );
  }

  const channelAbsolute =
    [0, 0, 0, 0];

  const channelMaximum =
    [0, 0, 0, 0];

  const channelDiffering =
    [0, 0, 0, 0];

  let absolute = 0;

  let maximum = 0;

  let differing = 0;

  for (
    let index = 0;
    index <
    left.data.length;
    index += 1
  ) {
    const difference =
      Math.abs(
        left.data[
          index
        ] -
          right.data[
            index
          ],
      );

    const channel =
      index % 4;

    channelAbsolute[
      channel
    ] += difference;

    channelMaximum[
      channel
    ] =
      Math.max(
        channelMaximum[
          channel
        ],
        difference,
      );

    if (
      difference !== 0
    ) {
      channelDiffering[
        channel
      ] += 1;

      differing += 1;

      maximum =
        Math.max(
          maximum,
          difference,
        );
    }

    absolute +=
      difference;
  }

  const pixels =
    left.data.length / 4;

  const channelStats = (
    index: number,
  ): ChannelStats => ({
    differingValues:
      channelDiffering[
        index
      ],
    maxAbsoluteByteDifference:
      channelMaximum[
        index
      ],
    meanAbsoluteByteDifference:
      channelAbsolute[
        index
      ] /
      pixels,
  });

  return {
    left:
      `${leftStrategy}-run-${leftRun}`,
    right:
      `${rightStrategy}-run-${rightRun}`,
    values:
      left.data.length,
    pixels,
    differingValues:
      differing,
    differingValueFraction:
      differing /
      left.data.length,
    maxAbsoluteByteDifference:
      maximum,
    meanAbsoluteByteDifference:
      absolute /
      left.data.length,
    channels: {
      r:
        channelStats(0),
      g:
        channelStats(1),
      b:
        channelStats(2),
      a:
        channelStats(3),
    },
  };
};

const withinStrategy =
  async (
    strategy: Strategy,
  ): Promise<
    readonly Comparison[]
  > => {
    const comparisons:
      Comparison[] = [];

    for (
      let left = 1;
      left <= runs;
      left += 1
    ) {
      for (
        let right =
          left + 1;
        right <= runs;
        right += 1
      ) {
        comparisons.push(
          await compare(
            strategy,
            left,
            strategy,
            right,
          ),
        );
      }
    }

    return comparisons;
  };

const versusStableCurrent =
  async (
    strategy: Exclude<
      Strategy,
      "current"
    >,
  ): Promise<
    readonly Comparison[]
  > => {
    const comparisons:
      Comparison[] = [];

    for (
      let run = 1;
      run <= runs;
      run += 1
    ) {
      comparisons.push(
        await compare(
          "current",
          2,
          strategy,
          run,
        ),
      );
    }

    return comparisons;
  };

const writeJson = async (
  path: string,
  value:
    StrategyReport | FinalReport,
): Promise<void> => {
  await writeFile(
    path,
    `${JSON.stringify(
      value,
      null,
      2,
    )}\n`,
  );
};

const finalize =
  async (): Promise<void> => {
    const current =
      reports.get(
        "current",
      );

    const noConversion =
      reports.get(
        "bitmap-no-color-conversion",
      );

    const htmlImage =
      reports.get(
        "html-image-srgb-canvas",
      );

    if (
      current ===
        undefined ||
      noConversion ===
        undefined ||
      htmlImage ===
        undefined
    ) {
      throw new Error(
        "Source-repeatability benchmark is missing a strategy report.",
      );
    }

    const report:
      FinalReport = {
        schemaVersion: 1,
        generatedAt:
          new Date().toISOString(),
        caseId:
          benchmarkCase.id,
        runs,
        reports: [
          current,
          noConversion,
          htmlImage,
        ],
        withinStrategy: {
          current:
            await withinStrategy(
              "current",
            ),
          "bitmap-no-color-conversion":
            await withinStrategy(
              "bitmap-no-color-conversion",
            ),
          "html-image-srgb-canvas":
            await withinStrategy(
              "html-image-srgb-canvas",
            ),
        },
        versusStableCurrent: {
          "bitmap-no-color-conversion":
            await versusStableCurrent(
              "bitmap-no-color-conversion",
            ),
          "html-image-srgb-canvas":
            await versusStableCurrent(
              "html-image-srgb-canvas",
            ),
        },
      };

    await writeJson(
      join(
        outputRoot,
        "browser-source-repeatability.json",
      ),
      report,
    );
  };

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut source repeatability benchmark</title>
  </head>
  <body>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const config = {
  caseId:
    benchmarkCase.id,
  inputUrl:
    "/input",
  runs,
  strategies,
};

const app =
  Bun.serve({
    hostname:
      "127.0.0.1",
    port,
    async fetch(request) {
      const url =
        new URL(
          request.url,
        );

      if (
        request.method ===
          "GET" &&
        url.pathname === "/"
      ) {
        return new Response(
          html,
          {
            headers: {
              "content-type":
                "text/html; charset=utf-8",
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/client.js"
      ) {
        return new Response(
          clientSource,
          {
            headers: {
              "content-type":
                "text/javascript; charset=utf-8",
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/config.json"
      ) {
        return Response.json(
          config,
          {
            headers: {
              "cache-control":
                "no-store",
            },
          },
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/input"
      ) {
        return new Response(
          Bun.file(
            resolve(
              manifestRoot,
              benchmarkCase.input,
            ),
          ),
          {
            headers: {
              "cache-control":
                "no-store",
            },
          },
        );
      }

      const outputMatch =
        url.pathname.match(
          /^\/output\/([^/]+)\/(\d+)$/u,
        );

      if (
        request.method ===
          "POST" &&
        outputMatch !== null
      ) {
        const strategy =
          Schema.decodeUnknownSync(
            StrategySchema,
          )(
            outputMatch[1],
          );

        const run =
          Number.parseInt(
            outputMatch[2],
            10,
          );

        if (
          run < 1 ||
          run > runs
        ) {
          return new Response(
            "Unknown repeatability run.",
            {
              status: 404,
            },
          );
        }

        const targetPath =
          outputPath(
            strategy,
            run,
          );

        await writeFile(
          targetPath,
          new Uint8Array(
            await request.arrayBuffer(),
          ),
        );

        return new Response(
          "saved",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/strategy-report"
      ) {
        const report =
          Schema.decodeUnknownSync(
            StrategyReportSchema,
          )(
            await request.json(),
          );

        reports.set(
          report.strategy,
          report,
        );

        await writeJson(
          join(
            strategyDirectory,
            `${report.strategy}.json`,
          ),
          report,
        );

        return new Response(
          "saved",
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/finalize"
      ) {
        try {
          await finalize();
        } catch (error) {
          return new Response(
            error instanceof Error
              ? error.message
              : String(error),
            {
              status: 422,
            },
          );
        }

        return new Response(
          "saved",
        );
      }

      return new Response(
        "Not found.",
        {
          status: 404,
        },
      );
    },
  });

console.log(
  `Safari source-repeatability benchmark ready at http://${app.hostname}:${app.port}/ for ${benchmarkCase.id}.`,
);
