import {
  createVideoSegmentationAdapter,
} from "./adapter";
import {
  createBiRefNetSeeder,
} from "./birefnet-seed";
import {
  VIDEO_SEGMENTATION_CANDIDATES,
} from "./candidates";
import {
  openMediaBunnyVideoSource,
} from "./media-source";

import type {
  VideoSegmentationMask,
} from "./types";

type PreviewFrame = {
  readonly source:
    ImageBitmap;
  readonly cutout:
    ImageBitmap;
};

type SeedChoice =
  | {
      readonly kind:
        "birefnet";
      readonly mask:
        VideoSegmentationMask;
      readonly detail:
        string;
    }
  | {
      readonly kind:
        "edge-grid";
      readonly point: {
        readonly x: number;
        readonly y: number;
      };
      readonly proposalIndex:
        number;
      readonly detail:
        string;
    };

const fileInput =
  document.querySelector<HTMLInputElement>(
    "#video-file",
  );

const runButton =
  document.querySelector<HTMLButtonElement>(
    "#run",
  );

const replayButton =
  document.querySelector<HTMLButtonElement>(
    "#replay",
  );

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

const sourceCanvas =
  document.querySelector<HTMLCanvasElement>(
    "#source",
  );

const cutoutCanvas =
  document.querySelector<HTMLCanvasElement>(
    "#cutout",
  );

if (
  fileInput === null ||
  runButton === null ||
  replayButton === null ||
  status === null ||
  sourceCanvas === null ||
  cutoutCanvas === null
) {
  throw new Error(
    "Video demo controls are missing.",
  );
}

const sourceContext =
  sourceCanvas.getContext(
    "2d",
  );

const cutoutContext =
  cutoutCanvas.getContext(
    "2d",
  );

if (
  sourceContext === null ||
  cutoutContext === null
) {
  throw new Error(
    "Video demo could not create 2D canvases.",
  );
}

let previewFrames:
  PreviewFrame[] = [];

let previewFps = 6;

let playing = false;

const writeStatus = (
  message: string,
): void => {
  status.textContent =
    message;
};

const clearFrames = () => {
  for (
    const frame of
    previewFrames
  ) {
    frame.source.close();
    frame.cutout.close();
  }

  previewFrames = [];
};

const discoveryGrid = (
  pointsPerSide: number,
) => {
  const points:
    {
      readonly x: number;
      readonly y: number;
      readonly label: 1;
    }[] = [];

  for (
    let y = 0;
    y <
    pointsPerSide;
    y += 1
  ) {
    for (
      let x = 0;
      x <
      pointsPerSide;
      x += 1
    ) {
      points.push({
        x:
          (x + 0.5) /
          pointsPerSide,
        y:
          (y + 0.5) /
          pointsPerSide,
        label: 1,
      });
    }
  }

  return points;
};

const stabilityScore = (
  mask:
    VideoSegmentationMask,
  offset = 1,
): number => {
  let intersection = 0;
  let union = 0;

  for (
    const logit of
    mask.logits
  ) {
    if (
      logit >
      offset
    ) {
      intersection += 1;
    }

    if (
      logit >
      -offset
    ) {
      union += 1;
    }
  }

  return union ===
    0
    ? 1
    : intersection /
        union;
};

const maskAreaFraction = (
  mask:
    VideoSegmentationMask,
): number => {
  let foreground = 0;

  for (
    const logit of
    mask.logits
  ) {
    if (
      logit >
      0
    ) {
      foreground +=
        1;
    }
  }

  return foreground /
    mask.logits.length;
};

const touchesFrame = (
  mask:
    VideoSegmentationMask,
): boolean => {
  for (
    let x = 0;
    x <
    mask.width;
    x += 1
  ) {
    if (
      (mask.logits[x] ??
        Number.NEGATIVE_INFINITY) >
        0 ||
      (mask.logits[
        (mask.height - 1) *
          mask.width +
          x
      ] ??
        Number.NEGATIVE_INFINITY) >
        0
    ) {
      return true;
    }
  }

  for (
    let y = 1;
    y <
    mask.height - 1;
    y += 1
  ) {
    if (
      (mask.logits[
        y *
          mask.width
      ] ??
        Number.NEGATIVE_INFINITY) >
        0 ||
      (mask.logits[
        y *
          mask.width +
          mask.width -
          1
      ] ??
        Number.NEGATIVE_INFINITY) >
        0
    ) {
      return true;
    }
  }

  return false;
};

const chooseSeed = async (
  frame: VideoFrame,
): Promise<SeedChoice> => {
  const seeder =
    await createBiRefNetSeeder(
      "fp16",
    );

  try {
    const seed =
      await seeder.seed(
        frame,
      );

    if (
      seed.positiveFraction >
      0
    ) {
      return {
        kind:
          "birefnet",
        mask: {
          logits:
            seed.logits,
          width:
            seed.width,
          height:
            seed.height,
        },
        detail:
          `BiRefNet direct matte · ${(
            seed.positiveFraction *
            100
          ).toFixed(
            2,
          )}% foreground`,
      };
    }
  } finally {
    await seeder.close();
  }

  const probe =
    await createVideoSegmentationAdapter(
      VIDEO_SEGMENTATION_CANDIDATES
        .edgetam,
    );

  try {
    if (
      probe.discover ===
      undefined
    ) {
      throw new Error(
        "EdgeTAM does not expose automatic discovery.",
      );
    }

    const discoveries =
      await probe.discover(
        frame,
        discoveryGrid(
          7,
        ),
      );

    const eligible =
      discoveries
        .map(
          (
            discovery,
            index,
          ) => ({
            discovery,
            index,
            stability:
              stabilityScore(
                discovery.mask,
              ),
            area:
              maskAreaFraction(
                discovery.mask,
              ),
          }),
        )
        .filter(
          ({ discovery }) =>
            discovery
              .proposalIndex ===
              0 &&
            !touchesFrame(
              discovery.mask,
            ),
        );

    const selected =
      eligible.reduce<
        typeof eligible[number] |
        undefined
      >(
        (
          best,
          current,
        ) => {
          if (
            best ===
            undefined
          ) {
            return current;
          }

          const currentScore =
            current.stability *
            Math.sqrt(
              current.area,
            );

          const bestScore =
            best.stability *
            Math.sqrt(
              best.area,
            );

          return currentScore >
            bestScore
            ? current
            : best;
        },
        undefined,
      );

    if (
      selected ===
      undefined
    ) {
      throw new Error(
        "EdgeTAM automatic discovery found no non-edge foreground candidate.",
      );
    }

    return {
      kind:
        "edge-grid",
      point: {
        x:
          selected.discovery
            .point.x,
        y:
          selected.discovery
            .point.y,
      },
      proposalIndex:
        selected.discovery
          .proposalIndex,
      detail:
        `EdgeTAM grid fallback · stability ${selected.stability.toFixed(
          3,
        )} · area ${(
          selected.area *
          100
        ).toFixed(
          2,
        )}%`,
    };
  } finally {
    await probe.close();
  }
};

const previewSize = (
  width: number,
  height: number,
) => {
  const maxWidth =
    960;

  if (
    width <=
    maxWidth
  ) {
    return {
      width,
      height,
    };
  }

  return {
    width:
      maxWidth,
    height:
      Math.max(
        1,
        Math.round(
          height *
            (
              maxWidth /
              width
            ),
        ),
      ),
  };
};

const alphaByte = (
  logit: number,
): number =>
  Math.round(
    255 /
      (
        1 +
        Math.exp(
          -logit,
        )
      ),
  );

const previewBitmaps = async (
  frame: VideoFrame,
  mask:
    VideoSegmentationMask,
  width: number,
  height: number,
): Promise<PreviewFrame> => {
  const source =
    new OffscreenCanvas(
      width,
      height,
    );

  const context =
    source.getContext(
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
      "Could not create the preview canvas.",
    );
  }

  context.drawImage(
    frame,
    0,
    0,
    width,
    height,
  );

  const cutout =
    new OffscreenCanvas(
      width,
      height,
    );

  const cutoutContext =
    cutout.getContext(
      "2d",
      {
        willReadFrequently:
          true,
      },
    );

  if (
    cutoutContext ===
    null
  ) {
    throw new Error(
      "Could not create the cutout canvas.",
    );
  }

  cutoutContext.drawImage(
    frame,
    0,
    0,
    width,
    height,
  );

  const pixels =
    cutoutContext.getImageData(
      0,
      0,
      width,
      height,
    );

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const maskY =
      Math.min(
        mask.height - 1,
        Math.floor(
          (
            (y + 0.5) /
            height
          ) *
            mask.height,
        ),
      );

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const maskX =
        Math.min(
          mask.width - 1,
          Math.floor(
            (
              (x + 0.5) /
              width
          ) *
            mask.width,
        ),
      );

      const logit =
        mask.logits[
          maskY *
            mask.width +
            maskX
        ] ??
        Number.NEGATIVE_INFINITY;

      pixels.data[
        (
          y *
            width +
          x
        ) *
          4 +
          3
      ] =
        alphaByte(
          logit,
        );
    }
  }

  cutoutContext.putImageData(
    pixels,
    0,
    0,
  );

  return {
    source:
      await createImageBitmap(
        source,
      ),
    cutout:
      await createImageBitmap(
        cutout,
      ),
  };
};

const drawFrame = (
  frame:
    PreviewFrame,
): void => {
  sourceContext.clearRect(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  );

  cutoutContext.clearRect(
    0,
    0,
    cutoutCanvas.width,
    cutoutCanvas.height,
  );

  sourceContext.drawImage(
    frame.source,
    0,
    0,
  );

  cutoutContext.drawImage(
    frame.cutout,
    0,
    0,
  );
};

const replay = async () => {
  if (
    playing ||
    previewFrames.length ===
      0
  ) {
    return;
  }

  playing =
    true;

  replayButton.disabled =
    true;

  try {
    for (
      const frame of
      previewFrames
    ) {
      drawFrame(
        frame,
      );

      await new Promise<void>(
        (resolve) => {
          setTimeout(
            resolve,
            1000 /
              previewFps,
          );
        },
      );
    }
  } finally {
    playing =
      false;

    replayButton.disabled =
      false;
  }
};

const run = async () => {
  const file =
    fileInput.files?.[0];

  if (
    file ===
    undefined
  ) {
    writeStatus(
      "Choose a local video first.",
    );

    return;
  }

  runButton.disabled =
    true;

  replayButton.disabled =
    true;

  clearFrames();

  const source =
    await openMediaBunnyVideoSource(
      file,
    );

  let adapter:
    Awaited<
      ReturnType<
        typeof createVideoSegmentationAdapter
      >
    > |
    undefined;

  try {
    const first =
      await source.frameAt(
        source.info
          .firstTimestamp,
      );

    if (
      first ===
      null
    ) {
      throw new Error(
        "MediaBunny could not decode the first video frame.",
      );
    }

    let choice:
      SeedChoice;

    try {
      writeStatus(
        "Loading the local models and choosing the foreground…",
      );

      choice =
        await chooseSeed(
          first.frame,
        );
    } finally {
      first.close();
    }

    adapter =
      await createVideoSegmentationAdapter(
        VIDEO_SEGMENTATION_CANDIDATES
          .edgetam,
      );

    const size =
      previewSize(
        source.info.width,
        source.info.height,
      );

    sourceCanvas.width =
      size.width;

    sourceCanvas.height =
      size.height;

    cutoutCanvas.width =
      size.width;

    cutoutCanvas.height =
      size.height;

    const duration =
      Math.max(
        0,
        source.info.duration,
      );

    const previewDuration =
      Math.min(
        duration,
        6,
      );

    previewFps =
      6;

    const frameCount =
      Math.max(
        1,
        Math.min(
          36,
          Math.floor(
            previewDuration *
              previewFps,
          ) +
            1,
        ),
      );

    const timestamps =
      Array.from(
        {
          length:
            frameCount,
        },
        (
          _,
          index,
        ) =>
          source.info
            .firstTimestamp +
          index /
            previewFps,
      );

    writeStatus(
      `${choice.detail}\nProcessing ${frameCount} preview frames locally…`,
    );

    for (
      let index = 0;
      index <
      timestamps.length;
      index += 1
    ) {
      const decoded =
        await source.frameAt(
          timestamps[index]!,
        );

      if (
        decoded ===
        null
      ) {
        break;
      }

      try {
        let prediction:
          VideoSegmentationMask;

        if (
          index ===
            0 &&
          choice.kind ===
            "birefnet"
        ) {
          if (
            adapter.seedMask ===
            undefined
          ) {
            throw new Error(
              "EdgeTAM does not support direct mask seeding.",
            );
          }

          prediction =
            await adapter.seedMask(
              decoded.frame,
              choice.mask,
              0,
              frameCount,
            );
        } else if (
          index ===
          0
        ) {
          prediction =
            await adapter.seed(
              decoded.frame,
              {
                points: [
                  {
                    ...choice.point,
                    label: 1,
                  },
                ],
                proposalIndex:
                  choice.proposalIndex,
              },
              0,
              frameCount,
            );
        } else {
          prediction =
            await adapter.track(
              decoded.frame,
              index,
              frameCount,
            );
        }

        const rendered =
          await previewBitmaps(
            decoded.frame,
            prediction,
            size.width,
            size.height,
          );

        previewFrames.push(
          rendered,
        );

        drawFrame(
          rendered,
        );

        writeStatus(
          `${choice.detail}\nProcessed ${previewFrames.length}/${frameCount} preview frames locally.`,
        );
      } finally {
        decoded.close();
      }
    }

    if (
      previewFrames.length ===
      0
    ) {
      throw new Error(
        "No preview frames were produced.",
      );
    }

    writeStatus(
      `${choice.detail}\nReady · ${previewFrames.length} frames · ${previewFps} fps preview · no upload.`,
    );

    replayButton.disabled =
      false;

    await replay();
  } finally {
    await adapter?.close();

    source.close();

    runButton.disabled =
      false;
  }
};

runButton.addEventListener(
  "click",
  () => {
    void run().catch(
      (error) => {
        const message =
          error instanceof
          Error
            ? error.message
            : String(
                error,
              );

        writeStatus(
          `Video preview failed: ${message}`,
        );

        runButton.disabled =
          false;
      },
    );
  },
);

replayButton.addEventListener(
  "click",
  () => {
    void replay();
  },
);
