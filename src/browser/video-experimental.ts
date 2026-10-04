import {
  BufferTarget,
  CanvasSource,
  Output,
  Quality,
  WebMOutputFormat,
} from "mediabunny";

import {
  createVideoSegmentationAdapter,
} from "../../scripts/benchmark/video-segmentation/adapter";
import {
  createBiRefNetSeeder,
} from "../../scripts/benchmark/video-segmentation/birefnet-seed";
import {
  VIDEO_SEGMENTATION_CANDIDATES,
} from "../../scripts/benchmark/video-segmentation/candidates";
import {
  openMediaBunnyVideoSource,
} from "../../scripts/benchmark/video-segmentation/media-source";

import type {
  VideoPointPrompt,
  VideoSegmentationDiscovery,
  VideoSegmentationMask,
  VideoSegmentationMaskAlternative,
  VideoSegmentationPrompt,
} from "../../scripts/benchmark/video-segmentation/types";

const SAMPLE_FPS = 6;

const MAX_DURATION_SECONDS = 15;

const MAX_OUTPUT_SIDE = 1280;

const GRID_POINTS_PER_SIDE = 7;

type VideoOutputSize = {
  readonly width: number;
  readonly height: number;
};

export type ExperimentalVideoProgress = {
  readonly stage:
    | "loading"
    | "seeding"
    | "tracking"
    | "encoding"
    | "done";
  readonly message: string;
  readonly progress: number;
  readonly frameIndex?: number;
  readonly frameCount?: number;
};

export type ExperimentalVideoResult = {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly duration: number;
  readonly sampleFps: number;
  readonly seed:
    | "sam21-prompt"
    | "birefnet-direct"
    | "edgetam-grid";
};

export type ExperimentalVideoOptions = {
  readonly prompt?:
    VideoSegmentationPrompt;
  readonly seedTimeSeconds?:
    number;
  readonly onProgress?: (
    progress:
      ExperimentalVideoProgress,
  ) => void;
  readonly onFrame?: (
    canvas:
      HTMLCanvasElement,
    frameIndex: number,
  ) => void;
};

const progress = (
  options:
    ExperimentalVideoOptions,
  value:
    ExperimentalVideoProgress,
) => {
  options.onProgress?.(
    value,
  );
};

const discoveryGrid = ():
  readonly VideoPointPrompt[] => {
  const points:
    VideoPointPrompt[] = [];

  for (
    let y = 0;
    y <
    GRID_POINTS_PER_SIDE;
    y += 1
  ) {
    for (
      let x = 0;
      x <
      GRID_POINTS_PER_SIDE;
      x += 1
    ) {
      points.push({
        x:
          (x + 0.5) /
          GRID_POINTS_PER_SIDE,
        y:
          (y + 0.5) /
          GRID_POINTS_PER_SIDE,
        label: 1,
      });
    }
  }

  return points;
};

const maskAreaFraction = (
  mask:
    VideoSegmentationMaskAlternative,
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
      foreground += 1;
    }
  }

  return foreground /
    mask.logits.length;
};

const maskTouchesFrame = (
  mask:
    VideoSegmentationMaskAlternative,
): boolean => {
  if (
    mask.width < 1 ||
    mask.height < 1
  ) {
    return true;
  }

  const foregroundAt = (
    x: number,
    y: number,
  ) =>
    (
      mask.logits[
        y *
          mask.width +
          x
      ] ??
      Number.NEGATIVE_INFINITY
    ) >
    0;

  for (
    let x = 0;
    x <
    mask.width;
    x += 1
  ) {
    if (
      foregroundAt(
        x,
        0,
      ) ||
      foregroundAt(
        x,
        mask.height - 1,
      )
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
      foregroundAt(
        0,
        y,
      ) ||
      foregroundAt(
        mask.width - 1,
        y,
      )
    ) {
      return true;
    }
  }

  return false;
};

const stabilityScore = (
  mask:
    VideoSegmentationMaskAlternative,
): number => {
  let intersection = 0;
  let union = 0;

  for (
    const logit of
    mask.logits
  ) {
    if (
      logit >
      1
    ) {
      intersection += 1;
    }

    if (
      logit >
      -1
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

const selectDiscovery = (
  discoveries:
    readonly VideoSegmentationDiscovery[],
): VideoSegmentationDiscovery => {
  const proposalZero =
    discoveries.filter(
      (discovery) =>
        discovery.proposalIndex ===
        0,
    );

  if (
    proposalZero.length ===
    0
  ) {
    throw new Error(
      "EdgeTAM did not return a proposal-0 seed candidate.",
    );
  }

  const nonEdge =
    proposalZero.filter(
      (discovery) =>
        !maskTouchesFrame(
          discovery.mask,
        ),
    );

  const pool =
    nonEdge.length >
    0
      ? nonEdge
      : proposalZero;

  return pool.reduce(
    (
      selected,
      current,
    ) => {
      const selectedScore =
        stabilityScore(
          selected.mask,
        ) *
        Math.sqrt(
          maskAreaFraction(
            selected.mask,
          ),
        );

      const currentScore =
        stabilityScore(
          current.mask,
        ) *
        Math.sqrt(
          maskAreaFraction(
            current.mask,
          ),
        );

      return currentScore >
        selectedScore
        ? current
        : selected;
    },
  );
};

const outputSize = (
  width: number,
  height: number,
): VideoOutputSize => {
  const scale =
    Math.min(
      1,
      MAX_OUTPUT_SIDE /
        Math.max(
          width,
          height,
        ),
    );

  return {
    width:
      Math.max(
        1,
        Math.round(
          width *
            scale,
        ),
      ),
    height:
      Math.max(
        1,
        Math.round(
          height *
            scale,
        ),
      ),
  };
};

const renderMask = (
  mask:
    VideoSegmentationMask,
  target:
    HTMLCanvasElement,
  maskCanvas:
    HTMLCanvasElement,
) => {
  maskCanvas.width =
    mask.width;
  maskCanvas.height =
    mask.height;

  const maskContext =
    maskCanvas.getContext(
      "2d",
    );

  if (
    maskContext ===
    null
  ) {
    throw new Error(
      "Could not create the video mask canvas.",
    );
  }

  const pixels =
    maskContext.createImageData(
      mask.width,
      mask.height,
    );

  for (
    let index = 0;
    index <
    mask.logits.length;
    index += 1
  ) {
    const probability =
      1 /
      (
        1 +
        Math.exp(
          -(
            mask.logits[
              index
            ] ??
            Number.NEGATIVE_INFINITY
          ),
        )
      );

    const offset =
      index *
      4;

    pixels.data[
      offset
    ] = 255;
    pixels.data[
      offset +
        1
    ] = 255;
    pixels.data[
      offset +
        2
    ] = 255;
    pixels.data[
      offset +
        3
    ] =
      Math.round(
        probability *
          255,
      );
  }

  maskContext.putImageData(
    pixels,
    0,
    0,
  );

  const context =
    target.getContext(
      "2d",
      {
        alpha: true,
      },
    );

  if (
    context ===
    null
  ) {
    throw new Error(
      "Could not create the transparent video canvas.",
    );
  }

  context.save();
  context.globalCompositeOperation =
    "destination-in";
  context.imageSmoothingEnabled =
    true;
  context.drawImage(
    maskCanvas,
    0,
    0,
    target.width,
    target.height,
  );
  context.restore();
};

const frameTimes = (
  firstTimestamp: number,
  duration: number,
): readonly number[] => {
  const usableDuration =
    Math.min(
      duration,
      MAX_DURATION_SECONDS,
    );

  const count =
    Math.max(
      1,
      Math.ceil(
        usableDuration *
          SAMPLE_FPS,
      ),
    );

  return Array.from(
    {
      length: count,
    },
    (
      _,
      index,
    ) =>
      firstTimestamp +
      index /
        SAMPLE_FPS,
  );
};

const seedFrameIndex = (
  timestamps:
    readonly number[],
  firstTimestamp: number,
  seedTimeSeconds:
    number | undefined,
): number => {
  if (
    timestamps.length ===
    0 ||
    seedTimeSeconds ===
    undefined ||
    !Number.isFinite(
      seedTimeSeconds,
    )
  ) {
    return 0;
  }

  const target =
    firstTimestamp +
    Math.max(
      0,
      seedTimeSeconds,
    );

  let selected = 0;

  let selectedDistance =
    Math.abs(
      (
        timestamps[0] ??
        firstTimestamp
      ) -
        target,
    );

  for (
    let index = 1;
    index <
    timestamps.length;
    index += 1
  ) {
    const distance =
      Math.abs(
        (
          timestamps[index] ??
          firstTimestamp
        ) -
          target,
      );

    if (
      distance <
      selectedDistance
    ) {
      selected =
        index;
      selectedDistance =
        distance;
    }
  }

  return selected;
};

export const removeVideoBackgroundExperimental =
  async (
    file: File,
    options:
      ExperimentalVideoOptions = {},
  ): Promise<ExperimentalVideoResult> => {
    progress(
      options,
      {
        stage: "loading",
        message:
          "Opening video and loading local models…",
        progress: 0,
      },
    );

    const source =
      await openMediaBunnyVideoSource(
        file,
      );

    const size =
      outputSize(
        source.info.width,
        source.info.height,
      );

    const canvas =
      document.createElement(
        "canvas",
      );

    canvas.width =
      size.width;
    canvas.height =
      size.height;

    const maskCanvas =
      document.createElement(
        "canvas",
      );

    const context =
      canvas.getContext(
        "2d",
        {
          alpha: true,
        },
      );

    if (
      context ===
      null
    ) {
      source.close();

      throw new Error(
        "This browser could not create a video canvas.",
      );
    }

    const target =
      new BufferTarget();

    const output =
      new Output({
        format:
          new WebMOutputFormat(),
        target,
      });

    const outputSource =
      new CanvasSource(
        canvas,
        {
          codec: "vp9",
          quality:
            new Quality(
              "medium",
            ),
          alpha: "keep",
        },
      );

    output.addVideoTrack(
      outputSource,
    );

    const prompted =
      options.prompt !==
      undefined;

    const biRefNet =
      prompted
        ? undefined
        : await createBiRefNetSeeder(
            "fp16",
          );

    const segmenter =
      await createVideoSegmentationAdapter(
        prompted
          ? VIDEO_SEGMENTATION_CANDIDATES[
              "sam21-tiny"
            ]
          : VIDEO_SEGMENTATION_CANDIDATES
              .edgetam,
        (value) => {
          progress(
            options,
            {
              stage: "loading",
              message:
                prompted
                  ? "Loading SAM 2.1…"
                  : "Loading EdgeTAM…",
              progress:
                Math.min(
                  0.18,
                  value *
                    0.18,
                ),
            },
          );
        },
      );

    const timestamps =
      frameTimes(
        source.info.firstTimestamp,
        source.info.duration,
      );

    const selectedSeedIndex =
      seedFrameIndex(
        timestamps,
        source.info.firstTimestamp,
        options.seedTimeSeconds,
      );

    const masks:
      (
        VideoSegmentationMask |
        undefined
      )[] =
        Array.from(
          {
            length:
              timestamps.length,
          },
        );

    let seedKind:
      ExperimentalVideoResult[
        "seed"
      ] =
        prompted
          ? "sam21-prompt"
          : "edgetam-grid";

    let encodedFrames = 0;

    try {
      const seedTimestamp =
        timestamps[
          selectedSeedIndex
        ];

      if (
        seedTimestamp ===
        undefined
      ) {
        throw new Error(
          "The selected video frame is outside the sampled clip.",
        );
      }

      const seedFrame =
        await source.frameAt(
          seedTimestamp,
        );

      if (
        seedFrame ===
        null
      ) {
        throw new Error(
          "The selected video frame could not be decoded.",
        );
      }

      try {
        progress(
          options,
          {
            stage:
              "seeding",
            message:
              prompted
                ? `Selecting subject at frame ${selectedSeedIndex + 1} of ${timestamps.length}…`
                : `Finding foreground at frame ${selectedSeedIndex + 1} of ${timestamps.length}…`,
            progress:
              0.2,
            frameIndex:
              selectedSeedIndex,
            frameCount:
              timestamps.length,
          },
        );

        let seedMask:
          VideoSegmentationMask;

        if (
          options.prompt !==
          undefined
        ) {
          seedMask =
            await segmenter.seed(
              seedFrame.frame,
              options.prompt,
              selectedSeedIndex,
              timestamps.length,
            );

          seedKind =
            "sam21-prompt";
        } else {
          if (
            biRefNet ===
            undefined
          ) {
            throw new Error(
              "Automatic video foreground discovery is unavailable.",
            );
          }

          const semantic =
            await biRefNet.seed(
              seedFrame.frame,
            );

          if (
            semantic
              .positiveFraction >
            0
          ) {
            if (
              segmenter.seedMask ===
              undefined
            ) {
              throw new Error(
                "EdgeTAM cannot accept the BiRefNet foreground matte.",
              );
            }

            seedMask =
              await segmenter.seedMask(
                seedFrame.frame,
                semantic,
                selectedSeedIndex,
                timestamps.length,
              );

            seedKind =
              "birefnet-direct";
          } else {
            if (
              segmenter.discover ===
                undefined ||
              segmenter.seedMask ===
                undefined
            ) {
              throw new Error(
                "EdgeTAM automatic foreground discovery is unavailable.",
              );
            }

            const discoveries =
              await segmenter.discover(
                seedFrame.frame,
                discoveryGrid(),
              );

            const selected =
              selectDiscovery(
                discoveries,
              );

            seedMask =
              await segmenter.seedMask(
                seedFrame.frame,
                selected.mask,
                selectedSeedIndex,
                timestamps.length,
              );

            seedKind =
              "edgetam-grid";
          }
        }

        masks[
          selectedSeedIndex
        ] =
          seedMask;
      } finally {
        seedFrame.close();
      }

      let trackedFrames = 1;

      const trackFrame =
        async (
          frameIndex: number,
          direction:
            "before" |
            "after",
        ) => {
          const timestamp =
            timestamps[
              frameIndex
            ];

          if (
            timestamp ===
            undefined
          ) {
            return;
          }

          const decoded =
            await source.frameAt(
              timestamp,
            );

          if (
            decoded ===
            null
          ) {
            return;
          }

          try {
            progress(
              options,
              {
                stage:
                  "tracking",
                message:
                  `Tracking ${direction} selected frame · ${frameIndex + 1} of ${timestamps.length}…`,
                progress:
                  0.2 +
                  (
                    trackedFrames /
                    Math.max(
                      1,
                      timestamps.length,
                    )
                  ) *
                    0.55,
                frameIndex,
                frameCount:
                  timestamps.length,
              },
            );

            masks[
              frameIndex
            ] =
              await segmenter.track(
                decoded.frame,
                frameIndex,
                timestamps.length,
              );

            trackedFrames +=
              1;
          } finally {
            decoded.close();
          }
        };

      for (
        let frameIndex =
          selectedSeedIndex +
          1;
        frameIndex <
        timestamps.length;
        frameIndex += 1
      ) {
        await trackFrame(
          frameIndex,
          "after",
        );
      }

      if (
        selectedSeedIndex >
        0
      ) {
        segmenter.rewind();

        for (
          let frameIndex =
            selectedSeedIndex -
            1;
          frameIndex >=
          0;
          frameIndex -= 1
        ) {
          await trackFrame(
            frameIndex,
            "before",
          );
        }
      }

      await output.start();

      let frameIndex = 0;

      for await (
        const decoded of
        source.framesAt(
          timestamps,
        )
      ) {
        const mask =
          masks[
            frameIndex
          ];

        if (
          decoded ===
            null ||
          mask ===
            undefined
        ) {
          decoded?.close();

          frameIndex +=
            1;

          continue;
        }

        try {
          context.clearRect(
            0,
            0,
            canvas.width,
            canvas.height,
          );

          context.globalCompositeOperation =
            "source-over";

          context.drawImage(
            decoded.frame,
            0,
            0,
            canvas.width,
            canvas.height,
          );

          renderMask(
            mask,
            canvas,
            maskCanvas,
          );

          options.onFrame?.(
            canvas,
            frameIndex,
          );

          progress(
            options,
            {
              stage:
                "encoding",
              message:
                `Encoding frame ${frameIndex + 1} of ${timestamps.length}…`,
              progress:
                0.76 +
                (
                  frameIndex /
                  Math.max(
                    1,
                    timestamps.length,
                  )
                ) *
                  0.18,
              frameIndex,
              frameCount:
                timestamps.length,
            },
          );

          await outputSource.add(
            encodedFrames /
              SAMPLE_FPS,
            1 /
              SAMPLE_FPS,
          );

          encodedFrames +=
            1;
        } finally {
          decoded.close();
        }

        frameIndex +=
          1;
      }

      if (
        encodedFrames ===
        0
      ) {
        throw new Error(
          "No video frames were available to encode.",
        );
      }

      outputSource.close();

      progress(
        options,
        {
          stage: "encoding",
          message:
            "Finalizing transparent WebM…",
          progress: 0.95,
        },
      );

      await output.finalize();

      const buffer =
        target.buffer;

      if (
        buffer ===
        null
      ) {
        throw new Error(
          "MediaBunny did not return an encoded video buffer.",
        );
      }

      const blob =
        new Blob(
          [buffer],
          {
            type:
              "video/webm",
          },
        );

      progress(
        options,
        {
          stage: "done",
          message:
            "Transparent video ready.",
          progress: 1,
        },
      );

      return {
        blob,
        width:
          canvas.width,
        height:
          canvas.height,
        frameCount:
          encodedFrames,
        duration:
          encodedFrames /
          SAMPLE_FPS,
        sampleFps:
          SAMPLE_FPS,
        seed:
          seedKind,
      };
    } finally {
      await segmenter.close();
      await biRefNet?.close();
      source.close();
    }
  };
