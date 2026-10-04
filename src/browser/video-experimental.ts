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
    | "birefnet-direct"
    | "edgetam-grid";
};

export type ExperimentalVideoOptions = {
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

    const biRefNet =
      await createBiRefNetSeeder(
        "fp16",
      );

    const edge =
      await createVideoSegmentationAdapter(
        VIDEO_SEGMENTATION_CANDIDATES
          .edgetam,
        (value) => {
          progress(
            options,
            {
              stage: "loading",
              message:
                "Loading EdgeTAM…",
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

    let seedKind:
      ExperimentalVideoResult[
        "seed"
      ] =
        "edgetam-grid";

    let frameIndex = 0;

    try {
      await output.start();

      for await (
        const decoded of
        source.framesAt(
          timestamps,
        )
      ) {
        if (
          decoded ===
          null
        ) {
          frameIndex +=
            1;
          continue;
        }

        try {
          progress(
            options,
            {
              stage:
                frameIndex ===
                0
                  ? "seeding"
                  : "tracking",
              message:
                frameIndex ===
                0
                  ? "Finding foreground…"
                  : `Tracking frame ${frameIndex + 1} of ${timestamps.length}…`,
              progress:
                0.2 +
                (
                  frameIndex /
                  Math.max(
                    1,
                    timestamps.length,
                  )
                ) *
                  0.7,
              frameIndex,
              frameCount:
                timestamps.length,
            },
          );

          let mask:
            VideoSegmentationMask;

          if (
            frameIndex ===
            0
          ) {
            const semantic =
              await biRefNet.seed(
                decoded.frame,
              );

            if (
              semantic
                .positiveFraction >
              0
            ) {
              if (
                edge.seedMask ===
                undefined
              ) {
                throw new Error(
                  "EdgeTAM cannot accept the BiRefNet foreground matte.",
                );
              }

              mask =
                await edge.seedMask(
                  decoded.frame,
                  semantic,
                  0,
                  timestamps.length,
                );

              seedKind =
                "birefnet-direct";
            } else {
              if (
                edge.discover ===
                  undefined ||
                edge.seedMask ===
                  undefined
              ) {
                throw new Error(
                  "EdgeTAM automatic foreground discovery is unavailable.",
                );
              }

              const discoveries =
                await edge.discover(
                  decoded.frame,
                  discoveryGrid(),
                );

              const selected =
                selectDiscovery(
                  discoveries,
                );

              mask =
                await edge.seedMask(
                  decoded.frame,
                  selected.mask,
                  0,
                  timestamps.length,
                );

              seedKind =
                "edgetam-grid";
            }
          } else {
            mask =
              await edge.track(
                decoded.frame,
                frameIndex,
                timestamps.length,
              );
          }

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
              stage: "encoding",
              message:
                `Encoding frame ${frameIndex + 1} of ${timestamps.length}…`,
              progress:
                0.2 +
                (
                  (
                    frameIndex +
                    0.75
                  ) /
                  Math.max(
                    1,
                    timestamps.length,
                  )
                ) *
                  0.7,
              frameIndex,
              frameCount:
                timestamps.length,
            },
          );

          await outputSource.add(
            frameIndex /
              SAMPLE_FPS,
            1 /
              SAMPLE_FPS,
          );
        } finally {
          decoded.close();
        }

        frameIndex +=
          1;
      }

      outputSource.close();

      progress(
        options,
        {
          stage: "encoding",
          message:
            "Finalizing transparent WebM…",
          progress: 0.94,
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
          frameIndex,
        duration:
          frameIndex /
          SAMPLE_FPS,
        sampleFps:
          SAMPLE_FPS,
        seed:
          seedKind,
      };
    } finally {
      await edge.close();
      await biRefNet.close();
      source.close();
    }
  };
