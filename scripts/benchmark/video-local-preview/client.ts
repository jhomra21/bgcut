import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
} from "mediabunny";

import {
  removeVideoBackgroundExperimental,
} from "../../../src/browser/video-experimental";

const FIXTURES = [
  "bear",
  "car-shadow",
  "bmx-trees",
] as const;

type FixtureId =
  typeof FIXTURES[number];

type PreviewFailure = {
  readonly schemaVersion: 2;
  readonly message: string;
  readonly stack: string;
};

type PreviewCase = {
  readonly fixture: FixtureId;
  readonly blobBytes: number;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly duration: number;
  readonly sampleFps: number;
  readonly seed: string;
  readonly transparentPixels: number;
  readonly opaqueOrPartialPixels: number;
};

type PreviewReport = {
  readonly schemaVersion: 2;
  readonly cases:
    readonly PreviewCase[];
};

type PreviewPost =
  | PreviewReport
  | PreviewFailure;

const postJson = async (
  path: string,
  value: PreviewPost,
) => {
  const response =
    await fetch(
      path,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify(
            value,
          ),
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      await response.text(),
    );
  }
};

const verifyAlpha = async (
  blob: Blob,
): Promise<{
  readonly transparentPixels:
    number;
  readonly opaqueOrPartialPixels:
    number;
}> => {
  const input =
    new Input({
      source:
        new BlobSource(
          blob,
        ),
      formats:
        ALL_FORMATS,
    });

  try {
    const track =
      await input.getPrimaryVideoTrack();

    if (
      track ===
      null
    ) {
      throw new Error(
        "Exported WebM has no video track.",
      );
    }

    const firstTimestamp =
      await track.getFirstTimestamp();

    const sink =
      new CanvasSink(
        track,
        {
          alpha: true,
        },
      );

    const wrapped =
      await sink.getCanvas(
        firstTimestamp,
      );

    if (
      wrapped ===
      null
    ) {
      throw new Error(
        "Exported WebM could not decode its first frame.",
      );
    }

    const context =
      wrapped.canvas.getContext(
        "2d",
      );

    if (
      context ===
      null
    ) {
      throw new Error(
        "Could not inspect exported WebM alpha.",
      );
    }

    const pixels =
      context.getImageData(
        0,
        0,
        wrapped.canvas.width,
        wrapped.canvas.height,
      ).data;

    let transparentPixels = 0;
    let opaqueOrPartialPixels = 0;

    for (
      let offset = 3;
      offset <
      pixels.length;
      offset += 4
    ) {
      const alpha =
        pixels[offset] ??
        255;

      if (
        alpha <
        255
      ) {
        transparentPixels +=
          1;
      }

      if (
        alpha >
        0
      ) {
        opaqueOrPartialPixels +=
          1;
      }
    }

    if (
      transparentPixels ===
      0
    ) {
      throw new Error(
        "Exported WebM decoded as fully opaque.",
      );
    }

    if (
      opaqueOrPartialPixels ===
      0
    ) {
      throw new Error(
        "Exported WebM decoded as fully transparent.",
      );
    }

    return {
      transparentPixels,
      opaqueOrPartialPixels,
    };
  } finally {
    input.dispose();
  }
};

const promptPointFromMask = async (
  fixture:
    FixtureId,
  frameIndex: number,
): Promise<{
  readonly x: number;
  readonly y: number;
  readonly label: 1;
}> => {
  const response =
    await fetch(
      `/quality/${fixture}/${frameIndex.toString().padStart(5, "0")}.png`,
      {
        cache:
          "no-store",
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Could not load ${fixture} seed mask: HTTP ${response.status}.`,
    );
  }

  const bitmap =
    await createImageBitmap(
      await response.blob(),
    );

  try {
    const canvas =
      document.createElement(
        "canvas",
      );

    canvas.width =
      bitmap.width;
    canvas.height =
      bitmap.height;

    const context =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        },
      );

    if (
      context ===
      null
    ) {
      throw new Error(
        "Could not inspect the DAVIS seed mask.",
      );
    }

    context.drawImage(
      bitmap,
      0,
      0,
    );

    const pixels =
      context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;

    let count = 0;
    let sumX = 0;
    let sumY = 0;

    for (
      let y = 0;
      y <
      canvas.height;
      y += 1
    ) {
      for (
        let x = 0;
        x <
        canvas.width;
        x += 1
      ) {
        const offset =
          (
            y *
              canvas.width +
            x
          ) *
          4;

        const foreground =
          (
            pixels[
              offset
            ] ??
            0
          ) >
            0 ||
          (
            pixels[
              offset +
                1
            ] ??
            0
          ) >
            0 ||
          (
            pixels[
              offset +
                2
            ] ??
            0
          ) >
            0;

        if (
          foreground
        ) {
          count += 1;
          sumX += x;
          sumY += y;
        }
      }
    }

    if (
      count ===
      0
    ) {
      throw new Error(
        `${fixture} seed mask contains no foreground.`,
      );
    }

    const centerX =
      sumX /
      count;

    const centerY =
      sumY /
      count;

    let bestX = 0;
    let bestY = 0;

    let bestDistance =
      Number.POSITIVE_INFINITY;

    for (
      let y = 0;
      y <
      canvas.height;
      y += 1
    ) {
      for (
        let x = 0;
        x <
        canvas.width;
        x += 1
      ) {
        const offset =
          (
            y *
              canvas.width +
            x
          ) *
          4;

        const foreground =
          (
            pixels[
              offset
            ] ??
            0
          ) >
            0 ||
          (
            pixels[
              offset +
                1
            ] ??
            0
          ) >
            0 ||
          (
            pixels[
              offset +
                2
            ] ??
            0
          ) >
            0;

        if (
          !foreground
        ) {
          continue;
        }

        const distance =
          (
            x -
            centerX
          ) **
            2 +
          (
            y -
            centerY
          ) **
            2;

        if (
          distance <
          bestDistance
        ) {
          bestDistance =
            distance;
          bestX = x;
          bestY = y;
        }
      }
    }

    return {
      x:
        (
          bestX +
          0.5
        ) /
        canvas.width,
      y:
        (
          bestY +
          0.5
        ) /
        canvas.height,
      label: 1,
    };
  } finally {
    bitmap.close();
  }
};

const promptPointsByObject = async (
  fixture:
    FixtureId,
  frameIndex: number,
  count: number,
): Promise<
  readonly {
    readonly x: number;
    readonly y: number;
    readonly label: 1;
  }[]
> => {
  const response =
    await fetch(
      `/quality/${fixture}/${frameIndex.toString().padStart(5, "0")}.png`,
      {
        cache:
          "no-store",
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Could not load ${fixture} object mask: HTTP ${response.status}.`,
    );
  }

  const bitmap =
    await createImageBitmap(
      await response.blob(),
    );

  try {
    const canvas =
      document.createElement(
        "canvas",
      );

    canvas.width =
      bitmap.width;
    canvas.height =
      bitmap.height;

    const context =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        },
      );

    if (
      context ===
      null
    ) {
      throw new Error(
        "Could not inspect the DAVIS object mask.",
      );
    }

    context.drawImage(
      bitmap,
      0,
      0,
    );

    const pixels =
      context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;

    const objects =
      new Map<
        string,
        {
          readonly red: number;
          readonly green: number;
          readonly blue: number;
          count: number;
          sumX: number;
          sumY: number;
        }
      >();

    for (
      let y = 0;
      y <
      canvas.height;
      y += 1
    ) {
      for (
        let x = 0;
        x <
        canvas.width;
        x += 1
      ) {
        const offset =
          (
            y *
              canvas.width +
            x
          ) *
          4;

        const red =
          pixels[offset] ??
          0;

        const green =
          pixels[
            offset +
              1
          ] ??
          0;

        const blue =
          pixels[
            offset +
              2
          ] ??
          0;

        const alpha =
          pixels[
            offset +
              3
          ] ??
          0;

        if (
          alpha ===
            0 ||
          (
            red ===
              0 &&
            green ===
              0 &&
            blue ===
              0
          )
        ) {
          continue;
        }

        const key =
          `${red},${green},${blue}`;

        const existing =
          objects.get(
            key,
          );

        if (
          existing ===
          undefined
        ) {
          objects.set(
            key,
            {
              red,
              green,
              blue,
              count: 1,
              sumX: x,
              sumY: y,
            },
          );

          continue;
        }

        existing.count +=
          1;
        existing.sumX +=
          x;
        existing.sumY +=
          y;
      }
    }

    const selected =
      [...objects.values()]
        .filter(
          (object) =>
            object.count >
            16,
        )
        .sort(
          (
            left,
            right,
          ) =>
            right.count -
            left.count,
        )
        .slice(
          0,
          count,
        );

    if (
      selected.length <
      count
    ) {
      throw new Error(
        `${fixture} frame ${frameIndex} exposed only ${selected.length} labeled foreground objects; expected ${count}.`,
      );
    }

    return selected.map(
      (object) => {
        const centerX =
          object.sumX /
          object.count;

        const centerY =
          object.sumY /
          object.count;

        let bestX = 0;
        let bestY = 0;

        let bestDistance =
          Number.POSITIVE_INFINITY;

        for (
          let y = 0;
          y <
          canvas.height;
          y += 1
        ) {
          for (
            let x = 0;
            x <
            canvas.width;
            x += 1
          ) {
            const offset =
              (
                y *
                  canvas.width +
                x
              ) *
              4;

            if (
              (
                pixels[
                  offset
                ] ??
                0
              ) !==
                object.red ||
              (
                pixels[
                  offset +
                    1
                ] ??
                0
              ) !==
                object.green ||
              (
                pixels[
                  offset +
                    2
                ] ??
                0
              ) !==
                object.blue
            ) {
              continue;
            }

            const distance =
              (
                x -
                centerX
              ) **
                2 +
              (
                y -
                centerY
              ) **
                2;

            if (
              distance <
              bestDistance
            ) {
              bestDistance =
                distance;
              bestX = x;
              bestY = y;
            }
          }
        }

        return {
          x:
            (
              bestX +
              0.5
            ) /
            canvas.width,
          y:
            (
              bestY +
              0.5
            ) /
            canvas.height,
          label: 1 as const,
        };
      },
    );
  } finally {
    bitmap.close();
  }
};

const runFixture = async (
  fixture:
    FixtureId,
): Promise<PreviewCase> => {
  const response =
    await fetch(
      `/quality/${fixture}.mp4`,
      {
        cache:
          "no-store",
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Could not load ${fixture}: HTTP ${response.status}.`,
    );
  }

  const file =
    new File(
      [
        await response.blob(),
      ],
      `${fixture}.mp4`,
      {
        type:
          "video/mp4",
      },
    );

  const prompt =
    fixture ===
    "bear"
      ? {
          points: [
            await promptPointFromMask(
              fixture,
              11,
            ),
          ],
        }
      : undefined;

  const multiObjectPoints =
    fixture ===
    "bmx-trees"
      ? await promptPointsByObject(
          fixture,
          11,
          2,
        )
      : undefined;

  const subjects =
    multiObjectPoints ===
    undefined
      ? undefined
      : multiObjectPoints.map(
          (
            point,
            index,
          ) => ({
            id:
              `subject-${index + 1}`,
            prompt: {
              points: [
                point,
              ],
            },
          }),
        );

  const promptedFixture =
    fixture ===
      "bear" ||
    fixture ===
      "bmx-trees";

  const result =
    await removeVideoBackgroundExperimental(
      file,
      {
        prompt,
        subjects,
        seedTimeSeconds:
          promptedFixture
            ? 11 /
              24
            : undefined,
      },
    );

  if (
    fixture ===
      "bear" &&
    result.seed !==
      "sam21-prompt"
  ) {
    throw new Error(
      `Prompted bear case used ${result.seed} instead of SAM 2.1.`,
    );
  }

  if (
    fixture ===
      "bmx-trees" &&
    result.seed !==
      "sam21-subjects"
  ) {
    throw new Error(
      `Multi-subject bmx-trees case used ${result.seed} instead of shared SAM 2.1 subject tracking.`,
    );
  }

  if (
    fixture ===
      "bear" &&
    result.frameCount <
      20
  ) {
    throw new Error(
      `Prompted bear case encoded only ${result.frameCount} frames after selecting a later seed frame.`,
    );
  }

  if (
    result.blob.size <
    1_000
  ) {
    throw new Error(
      `${fixture} WebM is unexpectedly small at ${result.blob.size} bytes.`,
    );
  }

  const alpha =
    await verifyAlpha(
      result.blob,
    );

  const outputResponse =
    await fetch(
      `/output/${fixture}.webm`,
      {
        method: "POST",
        body:
          result.blob,
      },
    );

  if (
    !outputResponse.ok
  ) {
    throw new Error(
      await outputResponse.text(),
    );
  }

  return {
    fixture,
    blobBytes:
      result.blob.size,
    width:
      result.width,
    height:
      result.height,
    frameCount:
      result.frameCount,
    duration:
      result.duration,
    sampleFps:
      result.sampleFps,
    seed:
      result.seed,
    ...alpha,
  };
};

const main =
  async () => {
    const cases:
      PreviewCase[] = [];

    for (
      const fixture of
      FIXTURES
    ) {
      cases.push(
        await runFixture(
          fixture,
        ),
      );
    }

    await postJson(
      "/result",
      {
        schemaVersion: 2,
        cases,
      },
    );
  };

void main().catch(
  (error) => {
    const parsed =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    void postJson(
      "/failure",
      {
        schemaVersion: 2,
        message:
          parsed.message,
        stack:
          parsed.stack ??
          "",
      },
    );
  },
);
