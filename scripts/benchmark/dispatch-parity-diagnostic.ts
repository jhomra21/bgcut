import { Schema } from "effect";
import sharp from "sharp";
import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";

const ChannelSchema = Schema.Literal(
  "r",
  "g",
  "b",
  "a",
);

type Channel =
  Schema.Schema.Type<
    typeof ChannelSchema
  >;

type ChannelStats = {
  readonly differingValues: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
};

type Comparison = {
  readonly left: string;
  readonly right: string;
  readonly width: number;
  readonly height: number;
  readonly values: number;
  readonly pixels: number;
  readonly differingValues: number;
  readonly differingValueFraction: number;
  readonly meanAbsoluteByteDifference: number;
  readonly maxAbsoluteByteDifference: number;
  readonly pixelsWithAnyDifference: number;
  readonly pixelsWithAlphaDifference: number;
  readonly pixelsWithRgbDifferenceAndEqualAlpha: number;
  readonly pixelsWithRgbDifferenceAtZeroAlpha: number;
  readonly channels: Readonly<
    Record<
      Channel,
      ChannelStats
    >
  >;
};

type Raster = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

const usage =
  "Usage: bun run benchmark:dispatch-parity-diagnostic -- <six-image-output-dir> [case-id] [report.json]";

const [
  outputArgument,
  caseId = "dog-blind-dog",
  reportArgument,
] = process.argv.slice(2);

if (
  outputArgument ===
  undefined
) {
  throw new Error(usage);
}

const outputRoot =
  resolve(
    outputArgument,
  );

const reportPath =
  reportArgument ===
  undefined
    ? join(
        outputRoot,
        "dispatch-parity-diagnostic.json",
      )
    : resolve(
        reportArgument,
      );

const modes =
  ["default", "64"] as const;

const runs =
  [1, 2, 3] as const;

const pathFor = (
  mode:
    (typeof modes)[number],
  run:
    (typeof runs)[number],
): string =>
  join(
    outputRoot,
    "outputs",
    mode,
    `${caseId}-run-${run}.png`,
  );

const readRaster = async (
  path: string,
): Promise<Raster> => {
  const result =
    await sharp(
      path,
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
      `Expected RGBA output at ${path}, got ${result.info.channels} channels.`,
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

const compare = (
  leftName: string,
  left: Raster,
  rightName: string,
  right: Raster,
): Comparison => {
  if (
    left.width !==
      right.width ||
    left.height !==
      right.height ||
    left.data.length !==
      right.data.length
  ) {
    throw new Error(
      `Raster dimensions differ between ${leftName} and ${rightName}.`,
    );
  }

  const channelNames:
    readonly Channel[] = [
      "r",
      "g",
      "b",
      "a",
    ];

  const channelAbsolute =
    [0, 0, 0, 0];

  const channelMaximum =
    [0, 0, 0, 0];

  const channelDiffering =
    [0, 0, 0, 0];

  let absolute = 0;
  let maximum = 0;
  let differing = 0;
  let pixelsWithAnyDifference =
    0;
  let pixelsWithAlphaDifference =
    0;
  let pixelsWithRgbDifferenceAndEqualAlpha =
    0;
  let pixelsWithRgbDifferenceAtZeroAlpha =
    0;

  const pixels =
    left.data.length / 4;

  for (
    let pixel = 0;
    pixel < pixels;
    pixel += 1
  ) {
    const offset =
      pixel * 4;

    let pixelDiffers =
      false;
    let rgbDiffers =
      false;

    for (
      let channel = 0;
      channel < 4;
      channel += 1
    ) {
      const difference =
        Math.abs(
          left.data[
            offset + channel
          ] -
            right.data[
              offset + channel
            ],
        );

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

        absolute +=
          difference;

        maximum =
          Math.max(
            maximum,
            difference,
          );

        differing += 1;
        pixelDiffers =
          true;

        if (
          channel < 3
        ) {
          rgbDiffers =
            true;
        }
      }
    }

    const alphaDiffers =
      left.data[
        offset + 3
      ] !==
      right.data[
        offset + 3
      ];

    if (
      pixelDiffers
    ) {
      pixelsWithAnyDifference +=
        1;
    }

    if (
      alphaDiffers
    ) {
      pixelsWithAlphaDifference +=
        1;
    }

    if (
      rgbDiffers &&
      !alphaDiffers
    ) {
      pixelsWithRgbDifferenceAndEqualAlpha +=
        1;

      if (
        left.data[
          offset + 3
        ] === 0
      ) {
        pixelsWithRgbDifferenceAtZeroAlpha +=
          1;
      }
    }
  }

  const channels =
    Object.fromEntries(
      channelNames.map(
        (
          name,
          index,
        ) => [
          name,
          {
            differingValues:
              channelDiffering[
                index
              ],
            meanAbsoluteByteDifference:
              channelAbsolute[
                index
              ] /
              pixels,
            maxAbsoluteByteDifference:
              channelMaximum[
                index
              ],
          } satisfies ChannelStats,
        ],
      ),
    ) as Record<
      Channel,
      ChannelStats
    >;

  return {
    left:
      leftName,
    right:
      rightName,
    width:
      left.width,
    height:
      left.height,
    values:
      left.data.length,
    pixels,
    differingValues:
      differing,
    differingValueFraction:
      differing /
      left.data.length,
    meanAbsoluteByteDifference:
      absolute /
      left.data.length,
    maxAbsoluteByteDifference:
      maximum,
    pixelsWithAnyDifference,
    pixelsWithAlphaDifference,
    pixelsWithRgbDifferenceAndEqualAlpha,
    pixelsWithRgbDifferenceAtZeroAlpha,
    channels,
  };
};

const rasters =
  new Map<
    string,
    Raster
  >();

for (
  const mode of modes
) {
  for (
    const run of runs
  ) {
    const label =
      `${mode}-run-${run}`;

    rasters.set(
      label,
      await readRaster(
        pathFor(
          mode,
          run,
        ),
      ),
    );
  }
}

const getRaster = (
  label: string,
): Raster => {
  const raster =
    rasters.get(
      label,
    );

  if (
    raster === undefined
  ) {
    throw new Error(
      `Missing raster ${label}.`,
    );
  }

  return raster;
};

const compareLabels = (
  left: string,
  right: string,
): Comparison =>
  compare(
    left,
    getRaster(left),
    right,
    getRaster(right),
  );

const withinDefault = [
  compareLabels(
    "default-run-1",
    "default-run-2",
  ),
  compareLabels(
    "default-run-1",
    "default-run-3",
  ),
  compareLabels(
    "default-run-2",
    "default-run-3",
  ),
];

const within64 = [
  compareLabels(
    "64-run-1",
    "64-run-2",
  ),
  compareLabels(
    "64-run-1",
    "64-run-3",
  ),
  compareLabels(
    "64-run-2",
    "64-run-3",
  ),
];

const paired = runs.map(
  (run) =>
    compareLabels(
      `default-run-${run}`,
      `64-run-${run}`,
    ),
);

const allCrossMode =
  runs.flatMap(
    (defaultRun) =>
      runs.map(
        (candidateRun) =>
          compareLabels(
            `default-run-${defaultRun}`,
            `64-run-${candidateRun}`,
          ),
      ),
  );

const report = {
  schemaVersion: 1,
  caseId,
  outputRoot,
  withinMode: {
    default:
      withinDefault,
    candidate64:
      within64,
  },
  paired,
  allCrossMode,
};

await mkdir(
  dirname(
    reportPath,
  ),
  {
    recursive: true,
  },
);

await writeFile(
  reportPath,
  `${JSON.stringify(
    report,
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      caseId,
      withinDefault:
        withinDefault.map(
          (comparison) => ({
            pair:
              `${comparison.left} vs ${comparison.right}`,
            differingValues:
              comparison.differingValues,
            alphaDifferences:
              comparison.channels.a
                .differingValues,
          }),
        ),
      within64:
        within64.map(
          (comparison) => ({
            pair:
              `${comparison.left} vs ${comparison.right}`,
            differingValues:
              comparison.differingValues,
            alphaDifferences:
              comparison.channels.a
                .differingValues,
          }),
        ),
      paired:
        paired.map(
          (comparison) => ({
            pair:
              `${comparison.left} vs ${comparison.right}`,
            differingValues:
              comparison.differingValues,
            alphaDifferences:
              comparison.channels.a
                .differingValues,
            rgbAtEqualAlpha:
              comparison.pixelsWithRgbDifferenceAndEqualAlpha,
          }),
        ),
      reportPath,
    },
    null,
    2,
  ),
);
