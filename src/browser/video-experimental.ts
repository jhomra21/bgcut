import { Effect, Exit, Scope, Semaphore } from "effect";
import { planVideoExport, VideoExportError, type VideoExportSettings } from "./video-export";

import {
  BufferTarget,
  canEncodeVideo,
  Mp4OutputFormat,
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
  readVideoSourceInfo,
} from "../../scripts/benchmark/video-segmentation/media-source";

import type {
  VideoPointPrompt,
  DecodedVideoFrame,
  VideoSegmentationAdapter,
  VideoSegmentationDiscovery,
  VideoSegmentationMask,
  VideoSegmentationMaskAlternative,
  VideoSegmentationPrompt,
  VideoSegmentationSubjectPrompt,
} from "../../scripts/benchmark/video-segmentation/types";

const GRID_POINTS_PER_SIDE = 7;

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
  readonly timings: { readonly decodingMs: number; readonly seedMs: number; readonly trackingMs: number; readonly encodingMs: number };
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly duration: number;
  readonly sampleFps: number;
  readonly seed:
    | "sam21-prompt"
    | "sam21-subjects"
    | "birefnet-direct"
    | "edgetam-grid";
};

export type ExperimentalVideoOptions = {
  readonly export?: VideoExportSettings;
  readonly signal?: AbortSignal;
  readonly prompt?:
    VideoSegmentationPrompt;
  readonly subjects?:
    readonly VideoSegmentationSubjectPrompt[];
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
  options.signal?.throwIfAborted();

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

const unionMasks = (
  masks:
    readonly VideoSegmentationMask[],
): VideoSegmentationMask => {
  const first =
    masks[0];

  if (
    first ===
    undefined
  ) {
    throw new Error(
      "Cannot combine an empty subject mask set.",
    );
  }

  if (
    masks.length ===
    1
  ) {
    return first;
  }

  const logits =
    new Float32Array(
      first.logits.length,
    );

  logits.fill(
    Number.NEGATIVE_INFINITY,
  );

  for (
    const mask of
    masks
  ) {
    if (
      mask.width !==
        first.width ||
      mask.height !==
        first.height ||
      mask.logits.length !==
        first.logits.length
    ) {
      throw new Error(
        "Tracked subject masks do not share the same geometry.",
      );
    }

    for (
      let index = 0;
      index <
      logits.length;
      index += 1
    ) {
      logits[index] =
        Math.max(
          logits[index] ??
            Number.NEGATIVE_INFINITY,
          mask.logits[
            index
          ] ??
            Number.NEGATIVE_INFINITY,
        );
    }
  }

  return {
    logits,
    width:
      first.width,
    height:
      first.height,
  };
};

type VideoMatte = { readonly width: number; readonly height: number; readonly alpha: Uint8ClampedArray };

// Store exactly the 8-bit soft alpha that compositing already produced, not 4-byte logits.
const matteFromMask = (mask: VideoSegmentationMask): VideoMatte => ({
  width: mask.width,
  height: mask.height,
  alpha: Uint8ClampedArray.from(mask.logits, (value) => Math.round(255 / (1 + Math.exp(-value)))),
});

const renderMask = (
  mask:
    VideoMatte,
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
    mask.alpha.length;
    index += 1
  ) {
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
      mask.alpha[index] ?? 0;
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

const removeVideo =
  async (
    file: File,
    options:
      ExperimentalVideoOptions,
    sharedSegmenter?: VideoSegmentationAdapter,
  ): Promise<ExperimentalVideoResult> => {
    const timings = { decodingMs: 0, seedMs: 0, trackingMs: 0, encodingMs: 0 };
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

    const releases: (() => void | Promise<void>)[] = [() => source.close()];

    try {
      const size = planVideoExport(source.info, options.export ?? {
        start: 0,
        end: Math.min(source.info.duration, 15),
      });

      const supported = await canEncodeVideo(size.codec, {
        width: size.width,
        height: size.height,
        quality: new Quality(size.quality),
        alpha: size.alpha,
        frameRate: size.maxFps,
      });

      if (!supported) {
        throw new VideoExportError({
          message: `This browser cannot encode ${size.format.toUpperCase()} at ${size.width}×${size.height}. Try a smaller size or another format.`,
        });
      }

      options.signal?.throwIfAborted();

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
        throw new VideoExportError({
          message: "This browser could not create a video canvas.",
        });
      }

      const target =
        new BufferTarget();

      const output =
        new Output({
          format:
            size.format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
          target,
        });

      const outputSource =
        new CanvasSource(
          canvas,
          {
            codec: size.codec,
            quality:
              new Quality(
                size.quality,
              ),
            alpha: size.alpha,
          },
        );

      releases.push(async () => {
        outputSource.close();

        if (output.state !== "finalized" && output.state !== "canceled") {
          await output.cancel();
        }
      });

      if (size.title) {
        output.setMetadataTags({ title: size.title });
      }

      output.addVideoTrack(
        outputSource,
      );

      const subjects =
        options.subjects ??
        (
          options.prompt ===
          undefined
            ? undefined
            : [
                {
                  id:
                    "subject-1",
                  prompt:
                    options.prompt,
                },
              ]
        );

      const prompted =
        subjects !==
          undefined &&
        subjects.length >
          0;

      const biRefNet =
        prompted
          ? undefined
          : await createBiRefNetSeeder(
              "fp16",
            );

      if (biRefNet !== undefined) {
        releases.push(() => biRefNet.close());
      }

      const segmenter =
        sharedSegmenter ?? await createVideoSegmentationAdapter(
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

      if (sharedSegmenter === undefined) {
        releases.push(() => segmenter.close());
      }

      const timestamps = await source.frameTimes(
        source.info.firstTimestamp + size.start,
        source.info.firstTimestamp + size.end,
        size.maxFps,
        options.signal,
      );

      const selectedSeedIndex =
        seedFrameIndex(
          timestamps,
          source.info.firstTimestamp,
          options.seedTimeSeconds,
        );

      const masks:
        (
          VideoMatte |
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
            ? (
                (
                  subjects?.length ??
                  0
                ) >
                1
                  ? "sam21-subjects"
                  : "sam21-prompt"
              )
            : "edgetam-grid";

      let encodedFrames = 0;

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

      // Preview and tracking must condition on the same decoded subject frame,
      // even when the chosen export cadence omits that source timestamp.
      const seedFrame = await source.frameAt(
        options.seedTimeSeconds === undefined
          ? seedTimestamp
          : source.info.firstTimestamp + Math.max(size.start, Math.min(size.end, options.seedTimeSeconds)),
      );

      if (
        seedFrame ===
        null
      ) {
        throw new Error(
          "The selected video frame could not be decoded.",
        );
      }

      timings.decodingMs += seedFrame.decodeMs;
      const seedStarted = performance.now();

      try {
        progress(
          options,
          {
            stage:
              "seeding",
            message:
              prompted
                ? `Selecting ${subjects?.length === 1 ? "subject" : `${subjects?.length ?? 0} subjects`} at frame ${selectedSeedIndex + 1} of ${timestamps.length}…`
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
          prompted
        ) {
          if (
            subjects ===
              undefined ||
            segmenter.seedSubjects ===
              undefined
          ) {
            throw new Error(
              "SAM 2.1 multi-subject tracking is unavailable.",
            );
          }

          seedMask =
            unionMasks(
              await segmenter.seedSubjects(
                seedFrame.frame,
                subjects,
                selectedSeedIndex,
                timestamps.length,
              ),
            );

          seedKind =
            subjects.length >
            1
              ? "sam21-subjects"
              : "sam21-prompt";
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
          matteFromMask(seedMask);
      } finally {
        timings.seedMs += performance.now() - seedStarted;
        seedFrame.close();
      }

      let trackedFrames = 1;

      const trackFrame =
        async (
          decoded: DecodedVideoFrame | null,
          frameIndex: number,
          direction:
            "before" |
            "after",
        ) => {
          if (
            decoded ===
            null
          ) {
            throw new VideoExportError({
              message: `Frame ${frameIndex + 1} could not be decoded. Choose a shorter range or another source video.`,
            });
          }

          timings.decodingMs += decoded.decodeMs;
          const trackingStarted = performance.now();

          try {
            options.signal?.throwIfAborted();
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

            const trackedMask = prompted
                ? unionMasks(
                    await (
                      segmenter.trackSubjects ??
                      (
                        () => {
                          throw new Error(
                            "SAM 2.1 multi-subject tracking is unavailable.",
                          );
                        }
                      )
                    )(
                      decoded.frame,
                      frameIndex,
                      timestamps.length,
                    ),
                  )
                : await segmenter.track(
                    decoded.frame,
                    frameIndex,
                    timestamps.length,
                  );

            masks[frameIndex] = matteFromMask(trackedMask);

            trackedFrames +=
              1;
          } finally {
            timings.trackingMs += performance.now() - trackingStarted;
            decoded.close();
          }
        };

      const trackRange = async (times: readonly number[], firstIndex: number, direction: "before" | "after") => {
        let index = firstIndex;

        for await (const decoded of source.framesAt(times)) {
          await trackFrame(decoded, index, direction);
          index += direction === "after" ? 1 : -1;
        }
      };

      await trackRange(timestamps.slice(selectedSeedIndex + 1), selectedSeedIndex + 1, "after");

      if (
        selectedSeedIndex >
        0
      ) {
        if (
          prompted
        ) {
          if (
            segmenter.rewindSubjects ===
            undefined
          ) {
            throw new Error(
              "SAM 2.1 multi-subject rewind is unavailable.",
            );
          }

          segmenter.rewindSubjects();
        } else {
          segmenter.rewind();
        }

        await trackRange(timestamps.slice(0, selectedSeedIndex).reverse(), selectedSeedIndex - 1, "before");
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
          throw new VideoExportError({
            message: `Frame ${frameIndex + 1} could not be exported. Choose another range and retry.`,
          });
        }

        timings.decodingMs += decoded.decodeMs;
        const encodingStarted = performance.now();

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

          if (size.format === "mp4") {
            context.globalCompositeOperation = "destination-over";
            context.fillStyle = size.background;
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.globalCompositeOperation = "source-over";
          }

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
            (timestamps[frameIndex] ?? timestamps[0] ?? 0) - (timestamps[0] ?? 0),
            (timestamps[frameIndex + 1] ?? source.info.firstTimestamp + size.end) - (timestamps[frameIndex] ?? 0),
          );

          encodedFrames +=
            1;
        } finally {
          timings.encodingMs += performance.now() - encodingStarted;
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
            `Finalizing ${size.format.toUpperCase()}…`,
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
              size.mime,
          },
        );

      progress(
        options,
        {
          stage: "done",
          message:
            "Video ready.",
          progress: 1,
        },
      );

      return {
        timings,
        blob,
        width:
          canvas.width,
        height:
          canvas.height,
        frameCount:
          encodedFrames,
        duration:
          size.duration,
        sampleFps: encodedFrames / size.duration,
        seed:
          seedKind,
      };
    } finally {
      await Promise.all(releases.reverse().map((release) => release()));
    }
  };

const videoBoundary = <T>(operation: () => Promise<T>): Promise<T> =>
  Effect.runPromise(Effect.tryPromise({
    try: operation,
    catch: (cause) => new VideoExportError({
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  }));

export const removeVideoBackgroundExperimental = (
  file: File,
  options: ExperimentalVideoOptions = {},
): Promise<ExperimentalVideoResult> => videoBoundary(() => removeVideo(file, options));

export const inspectVideo = (file: File) => videoBoundary(() => readVideoSourceInfo(file));

export const checkVideoEncoding = (file: File, settings: VideoExportSettings) =>
  videoBoundary(async () => {
    const plan = planVideoExport(await readVideoSourceInfo(file), settings);

    const supported = await canEncodeVideo(plan.codec, {
      width: plan.width, height: plan.height, quality: new Quality(plan.quality),
      alpha: plan.alpha, frameRate: plan.maxFps,
    });

    if (!supported) {
      throw new VideoExportError({
        message: `${plan.format.toUpperCase()} encoding at ${plan.width}×${plan.height} is unavailable in this browser. Choose another format or a smaller size.`,
      });
    }
  });

// Finish old GPU work and disposal before loading the next editor after a media switch.
const selectionGate = Semaphore.makeUnsafe(1);

/** One editor owns one SAM stack. Preview, tracking and disposal never overlap. */
export const createVideoSelection = (file: File) => {
  let segmenter: VideoSegmentationAdapter | undefined;
  let modelScope = Scope.makeUnsafe();
  let disposed = false;

  let previewFrame: {
    readonly time: number;
    readonly frame: VideoFrame;
  } | undefined;

  // Waiting fibers are interruptible; an in-flight ONNX call must settle before
  // releasing the GPU permit or closing its session. Signals are checked between calls.
  const serialize = <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
    Effect.runPromise(selectionGate.withPermit(Effect.uninterruptible(Effect.tryPromise({
      try: operation,
      catch: (cause) => new VideoExportError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    }))), { signal });

  const getSegmenter = async (onProgress?: (value: number) => void) => {
    segmenter ??= await Effect.runPromise(Effect.acquireRelease(
      Effect.tryPromise({
        try: () => createVideoSegmentationAdapter(VIDEO_SEGMENTATION_CANDIDATES["sam21-tiny"], (value) => {
          if (disposed) throw new VideoExportError({ message: "The video editor was closed." });

          onProgress?.(value);
        }),
        catch: (cause) => new VideoExportError({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      }),
      (model) => Effect.promise(() => model.close()),
    ).pipe(Scope.provide(modelScope)));

    return segmenter;
  };

  const getPreviewFrame = async (time: number) => {
  if (previewFrame?.time !== time) {
    previewFrame?.frame.close();
    previewFrame = undefined;
    const source = await openMediaBunnyVideoSource(file);

    try {
      const decoded = await source.frameAt(source.info.firstTimestamp + time);

      if (decoded !== null) {
        previewFrame = { time, frame: decoded.frame.clone() };
        decoded.close();
      }
    } finally {
      source.close();
    }
  }

  if (previewFrame === undefined) {
    throw new VideoExportError({ message: "This subject frame could not be opened. Choose another frame." });
  }

    return previewFrame.frame;
  };

  return {
    prepare(onProgress: (value: number) => void) {
      return serialize(async () => {
        if (disposed) throw new VideoExportError({ message: "The video editor was closed." });

        await getSegmenter(onProgress);
      });
    },
    prepareFrame(time: number, signal: AbortSignal) {
      return serialize(async () => {
        signal.throwIfAborted();

        if (disposed) throw new VideoExportError({ message: "The video editor was closed." });
        const model = await getSegmenter();
        signal.throwIfAborted();
        const frame = await getPreviewFrame(time);
        signal.throwIfAborted();
        await model.prepareFrame?.(frame);
        signal.throwIfAborted();
      }, signal);
    },
    preview(time: number, subjects: readonly VideoSegmentationSubjectPrompt[], signal: AbortSignal) {
      return serialize(async () => {
        signal.throwIfAborted();

        if (disposed) {
          throw new VideoExportError({ message: "The video editor was closed." });
        }

        const model = await getSegmenter();
        signal.throwIfAborted();

        const frame = await getPreviewFrame(time);

        if (model.seedSubjects === undefined) throw new VideoExportError({ message: "Subject selection is unavailable." });

        signal.throwIfAborted();
        const masks = await model.seedSubjects(frame, subjects, 0, 1);
        signal.throwIfAborted();

        return masks.map((mask) => ({
          width: mask.width,
          height: mask.height,
          alpha: Uint8ClampedArray.from(mask.logits, (value) => value > 0 ? 120 : 0),
        }));
      }, signal);
    },
    run(options: ExperimentalVideoOptions) {
      return serialize(async () => {
        options.signal?.throwIfAborted();

        if (disposed) {
          throw new VideoExportError({ message: "The video editor was closed." });
        }

        if (options.subjects === undefined && segmenter !== undefined) {
          await Effect.runPromise(Scope.close(modelScope, Exit.void));
          modelScope = Scope.makeUnsafe();
          segmenter = undefined;
        }

        return removeVideo(file, options, options.subjects === undefined ? undefined : await getSegmenter());
      }, options.signal);
    },
    close() {
      disposed = true;

      return serialize(async () => {
        previewFrame?.frame.close();
        previewFrame = undefined;
        await Effect.runPromise(Scope.close(modelScope, Exit.void));
        segmenter = undefined;
      });
    },
  };
};
