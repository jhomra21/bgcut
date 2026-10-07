import {
  ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, EncodedPacketSink,
  Input, Mp4OutputFormat, Output, Quality,
} from "mediabunny";
import { createVideoSelection } from "../../../src/browser/video-experimental";
import { createVideoSegmentationAdapter } from "../video-segmentation/adapter";
import { VIDEO_SEGMENTATION_CANDIDATES } from "../video-segmentation/candidates";
import {
  openMediaBunnyVideoSource,
  readVideoSourceInfo,
} from "../video-segmentation/media-source";
import { QUALITY_FRAME_COUNT } from "../video-segmentation/quality-fixture";
import { binaryMaskIou, davisBoundaryF } from "../video-segmentation/quality-metrics";
import type {
  VideoSegmentationCandidateId,
  VideoSegmentationMask,
} from "../video-segmentation/types";

const save = async (name: string, blob: Blob) => {
  const response = await fetch(`/output/${name}`, { method: "POST", body: blob });

  if (!response.ok) throw new Error(await response.text());
};

const inspect = async (blob: Blob) => {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

  try {
    const track = await input.getPrimaryVideoTrack();

    if (track === null) throw new Error("Export has no video track.");
    const timestamps: number[] = [];

    for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      timestamps.push(packet.timestamp);
    }

    timestamps.sort((a, b) => a - b);
    const canvas = await new CanvasSink(track, { alpha: true }).getCanvas(0);

    if (canvas === null) throw new Error("Export cannot decode.");
    const pixels = canvas.canvas.getContext("2d")?.getImageData(0, 0, canvas.canvas.width, canvas.canvas.height).data;

    if (pixels === undefined) throw new Error("Export cannot be read.");

    return {
      count: timestamps.length, timestamps, duration: await input.computeDuration(), codec: track.codec,
      width: canvas.canvas.width, height: canvas.canvas.height,
      transparent: pixels.filter((value, index) => index % 4 === 3 && value < 32).length,
      pixels,
    };
  } finally {
    input.dispose();
  }
};

const generatedSixty = async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Missing test canvas.");
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat() });
  const source = new CanvasSource(canvas, { codec: "avc", quality: new Quality("high") });
  output.addVideoTrack(source);
  await output.start();

  for (let index = 0; index < 60; index += 1) {
    context.fillStyle = "#d4e6e0";
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = "#b72525";
    context.fillRect(30 + index * 2, 40, 60, 100);
    context.fillStyle = "white";
    context.font = "22px sans-serif";
    context.fillText(String(index), 40 + index * 2, 95);
    await source.add(index / 60, 1 / 60);
  }

  source.close();
  await output.finalize();

  if (target.buffer === null) throw new Error("Missing 60 fps fixture.");

  return new File([target.buffer], "genuine-sixty.mp4", { type: "video/mp4" });
};

const generatedVfrNonzero = async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Missing VFR test canvas.");
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat() });
  const source = new CanvasSource(canvas, { codec: "avc", quality: new Quality("high") });
  const timestamps = [2, 2.04, 2.09, 2.15, 2.24, 2.33, 2.46, 2.55, 2.7, 2.82, 2.94] as const;
  const end = 3;
  output.addVideoTrack(source);
  await output.start();

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];

    if (timestamp === undefined) throw new Error("Missing VFR fixture timestamp.");
    const next = timestamps[index + 1] ?? end;
    context.fillStyle = "#d4e6e0";
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = "#b72525";
    context.fillRect(30 + index * 10, 40, 70, 100);
    context.fillStyle = "white";
    context.font = "22px sans-serif";
    context.fillText(String(index), 45 + index * 10, 95);
    await source.add(timestamp, next - timestamp);
  }

  source.close();
  await output.finalize();

  if (target.buffer === null) throw new Error("Missing VFR fixture.");

  return {
    file: new File([target.buffer], "vfr-nonzero.mp4", { type: "video/mp4" }),
    timestamps,
    end,
  };
};

const benchmarkVfrNonzero = async () => {
  const generated = await generatedVfrNonzero();
  const info = await readVideoSourceInfo(generated.file);

  if (Math.abs(info.firstTimestamp - 2) > 0.001 || Math.abs(info.duration - 1) > 0.001) {
    throw new Error(`VFR fixture lost its nonzero source timeline: ${JSON.stringify(info)}`);
  }

  const editor = createVideoSelection(generated.file);

  const subjects = [{
    id: "subject-0",
    prompt: { points: [{ x: 0.22, y: 0.5, label: 1 as const }] },
  }];

  const start = 0.025;
  const end = 1;

  try {
    await editor.prepare(() => undefined);
    await editor.prepareFrame(0.2, new AbortController().signal);
    await editor.preview(0.2, subjects, new AbortController().signal);

    const result = await editor.run({
      subjects,
      seedTimeSeconds: 0.2,
      export: { start, end, frameRate: "source", format: "mp4", quality: "high" },
    });

    await save("vfr-nonzero-source.mp4", result.blob);

    const decoded = await inspect(result.blob);
    const absoluteStart = info.firstTimestamp + start;

    const expected = [
      0,
      ...generated.timestamps
        .filter((timestamp) => timestamp > absoluteStart && timestamp < info.firstTimestamp + end)
        .map((timestamp) => timestamp - absoluteStart),
    ];

    if (
      decoded.timestamps.length !== expected.length ||
      Math.abs(decoded.duration - (end - start)) > 0.001 ||
      decoded.timestamps.some((timestamp, index) => Math.abs(timestamp - (expected[index] ?? Number.NaN)) > 0.001)
    ) {
      throw new Error(`VFR/nonzero export changed presentation timing: ${JSON.stringify({
        input: generated.timestamps,
        expected,
        output: decoded.timestamps,
        duration: decoded.duration,
      })}`);
    }

    return {
      name: "vfr-nonzero",
      sourceFirstTimestamp: info.firstTimestamp,
      sourceDuration: info.duration,
      trim: { start, end },
      sourceTimestamps: generated.timestamps,
      outputTimestamps: decoded.timestamps,
      outputDuration: decoded.duration,
      frames: result.frameCount,
      outputFps: result.sampleFps,
      timings: result.timings,
    };
  } finally {
    await editor.close();
  }
};

const truthMask = async (
  fixture: string,
  frameIndex: number,
): Promise<{
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
}> => {
  const response =
    await fetch(
      `/quality/${fixture}/${frameIndex.toString().padStart(5, "0")}.png`,
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Could not load ${fixture} truth frame ${frameIndex}: HTTP ${response.status}.`,
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
        "Could not inspect DAVIS truth mask.",
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

    return {
      width:
        canvas.width,
      height:
        canvas.height,
      mask:
        Uint8Array.from(
          {
            length:
              canvas.width *
              canvas.height,
          },
          (
            _,
            index,
          ) =>
            (
              pixels[
                index *
                  4
              ] ??
              0
            ) >
            0
              ? 1
              : 0,
        ),
    };
  } finally {
    bitmap.close();
  }
};

const scoreSegmentationMask = (
  prediction:
    VideoSegmentationMask,
  truth: {
    readonly mask:
      Uint8Array;
    readonly width:
      number;
    readonly height:
      number;
  },
) => {
  const predicted =
    Uint8Array.from(
      {
        length:
          truth.width *
          truth.height,
      },
      (
        _,
        index,
      ) => {
        const x =
          Math.min(
            prediction.width -
              1,
            Math.floor(
              (
                index %
                truth.width
              ) *
                prediction.width /
                truth.width,
            ),
          );

        const y =
          Math.min(
            prediction.height -
              1,
            Math.floor(
              Math.floor(
                index /
                  truth.width,
              ) *
                prediction.height /
                truth.height,
            ),
          );

        return (
          prediction.logits[
            y *
              prediction.width +
              x
          ] ??
          Number.NEGATIVE_INFINITY
        ) >
        0
          ? 1
          : 0;
      },
    );

  return {
    iou:
      binaryMaskIou(
        predicted,
        truth.mask,
      ),
    boundaryF:
      davisBoundaryF(
        predicted,
        truth.mask,
        truth.width,
        truth.height,
      ),
  };
};

const benchmarkPromptTracker = async (
  file: File,
  candidateId:
    VideoSegmentationCandidateId,
  point: {
    readonly x: number;
    readonly y: number;
    readonly label: 1;
  },
) => {
  const source =
    await openMediaBunnyVideoSource(
      file,
    );

  const candidate =
    VIDEO_SEGMENTATION_CANDIDATES[
      candidateId
    ];

  const loadStarted =
    performance.now();

  const adapter =
    await createVideoSegmentationAdapter(
      candidate,
    );

  const adapterLoadMs =
    performance.now() -
    loadStarted;

  try {
    const trackingPrepareStarted =
      performance.now();

    await adapter.prepareTracking?.();

    const trackingPrepareMs =
      performance.now() -
      trackingPrepareStarted;

    const timestamps =
      (
        await source.frameTimes(
          source.info.firstTimestamp,
          source.info.firstTimestamp +
            Math.min(
              1,
              source.info.duration,
            ),
          24,
        )
      ).slice(
        0,
        QUALITY_FRAME_COUNT,
      );

    if (
      timestamps.length <
      2
    ) {
      throw new Error(
        "Prompt tracker benchmark needs at least two frames.",
      );
    }

    const truths =
      await Promise.all(
        timestamps.map(
          (
            _,
            index,
          ) =>
            truthMask(
              "bear",
              index,
            ),
        ),
      );

    const seedTimestamp =
      timestamps[0];

    if (
      seedTimestamp ===
      undefined
    ) {
      throw new Error(
        "Prompt tracker benchmark has no seed timestamp.",
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
        "Prompt tracker benchmark could not decode its seed frame.",
      );
    }

    let seedMs =
      0;

    let trackingMs =
      0;

    let decodingMs =
      seedFrame.decodeMs;

    const scores: {
      readonly iou: number;
      readonly boundaryF:
        number;
    }[] = [];

    try {
      const seedStarted =
        performance.now();

      const seed =
        await adapter.seed(
          seedFrame.frame,
          candidateId ===
            "edgetam"
            ? {
                points: [
                  point,
                ],
                proposalIndex: 0,
              }
            : {
                points: [
                  point,
                ],
              },
          0,
          timestamps.length,
        );

      seedMs =
        performance.now() -
        seedStarted;

      const truth =
        truths[0];

      if (
        truth ===
        undefined
      ) {
        throw new Error(
          "Prompt tracker benchmark is missing seed truth.",
        );
      }

      scores.push(
        scoreSegmentationMask(
          seed,
          truth,
        ),
      );
    } finally {
      seedFrame.close();
    }

    let frameIndex =
      1;

    for await (
      const decoded of
      source.framesAt(
        timestamps.slice(
          1,
        ),
      )
    ) {
      if (
        decoded ===
        null
      ) {
        throw new Error(
          `Prompt tracker benchmark could not decode frame ${frameIndex}.`,
        );
      }

      decodingMs +=
        decoded.decodeMs;

      try {
        const trackingStarted =
          performance.now();

        const mask =
          await adapter.track(
            decoded.frame,
            frameIndex,
            timestamps.length,
          );

        trackingMs +=
          performance.now() -
          trackingStarted;

        const truth =
          truths[
            frameIndex
          ];

        if (
          truth ===
          undefined
        ) {
          throw new Error(
            `Prompt tracker benchmark is missing truth frame ${frameIndex}.`,
          );
        }

        scores.push(
          scoreSegmentationMask(
            mask,
            truth,
          ),
        );
      } finally {
        decoded.close();
      }

      frameIndex +=
        1;
    }

    const mean = (
      values:
        readonly number[],
    ) =>
      values.reduce(
        (
          total,
          value,
        ) =>
          total +
          value,
        0,
      ) /
      values.length;

    return {
      candidate:
        candidateId,
      adapterLoadMs,
      trackingPrepareMs,
      seedMs,
      decodingMs,
      trackingMs,
      trackingFps:
        (
          scores.length -
          1
        ) /
        (
          trackingMs /
          1000
        ),
      meanIou:
        mean(
          scores.map(
            (score) =>
              score.iou,
          ),
        ),
      worstIou:
        Math.min(
          ...scores.map(
            (score) =>
              score.iou,
          ),
        ),
      meanBoundaryF:
        mean(
          scores.map(
            (score) =>
              score.boundaryF,
          ),
        ),
      worstBoundaryF:
        Math.min(
          ...scores.map(
            (score) =>
              score.boundaryF,
          ),
        ),
      frameCount:
        scores.length,
    };
  } finally {
    source.close();
    await adapter.close();
  }
};

const benchmark = async (name: string, file: File, points: readonly { x: number; y: number; label: 1 }[]) => {
  const editor = createVideoSelection(file);

  const subjects = points.map((point, index) => ({
    id: `subject-${index}`,
    prompt: { points: [point, ...points.flatMap((other, otherIndex) => otherIndex === index ? [] : [{ ...other, label: 0 as const }])] },
  }));

  const cases = [];

  let started =
    performance.now();

  try {
    const modelMilestones: { readonly progress: number; readonly elapsedMs: number }[] = [];

    const prepareStarted =
      started;

    await editor.prepare((progress) => {
      modelMilestones.push({
        progress,
        elapsedMs:
          performance.now() -
          prepareStarted,
      });
    });

    const modelMs =
      performance.now() -
      prepareStarted;

    started =
      performance.now();

    const seedTime =
      name ===
      "bmx-trees"
        ? 0.5
        : 0;

    const framePreparation =
      await editor.prepareFrame(
        seedTime,
        new AbortController()
          .signal,
      );

    const frameWarmMs =
      performance.now() -
      started;

    started = performance.now();
    await editor.preview(seedTime, subjects, new AbortController().signal);
    const firstClickMs = performance.now() - started;
    started = performance.now();
    await editor.preview(seedTime, subjects, new AbortController().signal);
    const warmClickMs = performance.now() - started;

    let configurations:
      readonly {
        readonly frameRate:
          | "source"
          | 6;
        readonly trackingFrameRate:
          number |
          undefined;
      }[];

    if (
      name ===
      "sixty"
    ) {
      configurations = [
        {
          frameRate:
            "source",
          trackingFrameRate:
            60,
        },
        {
          frameRate:
            "source",
          trackingFrameRate:
            30,
        },
        {
          frameRate:
            "source",
          trackingFrameRate:
            24,
        },
        {
          frameRate:
            "source",
          trackingFrameRate:
            12,
        },
      ];
    } else if (
      name ===
        "bear" ||
      name ===
        "bmx-trees"
    ) {
      configurations = [
        {
          frameRate:
            "source",
          trackingFrameRate:
            undefined,
        },
        {
          frameRate:
            "source",
          trackingFrameRate:
            12,
        },
        {
          frameRate:
            "source",
          trackingFrameRate:
            8,
        },
        {
          frameRate:
            6,
          trackingFrameRate:
            undefined,
        },
      ];
    } else {
      configurations = [
        {
          frameRate:
            "source",
          trackingFrameRate:
            undefined,
        },
        {
          frameRate:
            6,
          trackingFrameRate:
            undefined,
        },
      ];
    }

    const cadenceFixture =
      name ===
        "bear" ||
      name ===
        "bmx-trees"
        ? name
        : undefined;

    const cadenceTruths =
      cadenceFixture ===
      undefined
        ? undefined
        : await Promise.all(
            Array.from(
              {
                length:
                  QUALITY_FRAME_COUNT,
              },
              (
                _,
                index,
              ) =>
                truthMask(
                  cadenceFixture,
                  index,
                ),
            ),
          );

    let referenceAlphaFrames:
      readonly Uint8Array[] |
      undefined;

    for (
      const configuration of
      configurations
    ) {
      const frameRate =
        configuration.frameRate;

      let firstFrame: Uint8ClampedArray | undefined;

      const alphaFrames:
        Uint8Array[] =
          [];

      const stages: Partial<Record<string, number>> = {};

      started = performance.now();

      const result = await editor.run({
        subjects,
        seedTimeSeconds:
          seedTime,
        trackingFrameRate:
          configuration.trackingFrameRate,
        export: { start: 0, end: 1, frameRate, format: "mp4", quality: frameRate === 6 ? "medium" : "high" },
        onProgress: (update) => { stages[update.stage] ??= performance.now() - started; },
        onFrame: (canvas) => {
          if (
            name !==
              "sixty" &&
            name !==
              "bear" &&
            name !==
              "bmx-trees"
          ) {
            return;
          }

          const pixels =
            canvas
              .getContext(
                "2d",
              )
              ?.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;

          if (
            pixels ===
            undefined
          ) {
            throw new Error(
              "Could not inspect raw segmentation frame.",
            );
          }

          const alpha =
            new Uint8Array(
              canvas.width *
                canvas.height,
            );

          for (
            let pixel = 0;
            pixel <
            alpha.length;
            pixel += 1
          ) {
            alpha[pixel] =
              pixels[
                pixel *
                  4 +
                  3
              ] ??
              0;
          }

          alphaFrames.push(
            alpha,
          );
        },
        onOutputFrame: (
          canvas,
          index,
        ) => {
          if (
            index !==
            0
          ) {
            return;
          }

          firstFrame =
            canvas
              .getContext(
                "2d",
              )
              ?.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
        },
      });

      const totalMs = performance.now() - started;

      if (result.timings.trackingMs <= 0 || result.timings.decodingMs < 0 || result.timings.encodingMs <= 0) {
        throw new Error("Missing measured processing stages.");
      }

      const trackingSuffix =
        configuration.trackingFrameRate ===
        undefined
          ? ""
          : `-track-${configuration.trackingFrameRate}`;

      await save(
        `${name}-${frameRate}${trackingSuffix}.mp4`,
        result.blob,
      );

      const decoded =
        await inspect(
          result.blob,
        );

      const expected = name === "sixty" ? 60 : frameRate === 6 ? 6 : 24;

      if (decoded.count !== expected || result.frameCount !== expected || new Set(decoded.timestamps).size !== expected) {
        throw new Error(`Incorrect real source cadence for ${name}: ${decoded.count}, expected ${expected}`);
      }

      if (firstFrame === undefined) throw new Error("No composited reference.");
      let squaredError = 0;
      let rgbSum = 0;

      for (let index = 0; index < firstFrame.length; index += 1) {
        if (index % 4 === 3) continue;
        rgbSum += firstFrame[index] ?? 0;
        squaredError += ((firstFrame[index] ?? 0) - (decoded.pixels[index] ?? 0)) ** 2;
      }

      const mse = squaredError / (result.width * result.height * 3);

      if (
        (
          name ===
            "sixty" ||
          name ===
            "bear"
        ) &&
        alphaFrames.length >
        0
      ) {
        const firstAlpha =
          alphaFrames[0];

        if (
          firstAlpha ===
          undefined
        ) {
          throw new Error(
            "Missing raw alpha reference frame.",
          );
        }

        let transparentPixels =
          0;

        let foregroundPixels =
          0;

        for (
          const alpha of
          firstAlpha
        ) {
          if (
            alpha <
            32
          ) {
            transparentPixels +=
              1;
          }

          if (
            alpha >
            223
          ) {
            foregroundPixels +=
              1;
          }
        }

        if (
          transparentPixels ===
            0 ||
          foregroundPixels ===
            0
        ) {
          throw new Error(
            `Raw segmentation frame is not a foreground/transparent matte: ${transparentPixels} transparent, ${foregroundPixels} foreground.`,
          );
        }
      }

      let referenceMaskMeanAbsoluteError:
        number |
        undefined;

      let referenceMaskMeanIou:
        number |
        undefined;

      let referenceMaskWorstIou:
        number |
        undefined;

      if (
        (
          name ===
            "sixty" ||
          (
            (
              name ===
                "bear" ||
              name ===
                "bmx-trees"
            ) &&
            frameRate ===
              "source"
          )
        )
      ) {
        const expectedAlphaFrames =
          name ===
          "sixty"
            ? 60
            : 24;

        if (
          alphaFrames.length !==
          expectedAlphaFrames
        ) {
          throw new Error(
            `Tracking-cadence mask comparison captured ${alphaFrames.length} frames instead of ${expectedAlphaFrames}.`,
          );
        }

        if (
          referenceAlphaFrames ===
          undefined
        ) {
          referenceAlphaFrames =
            alphaFrames;
        } else {
          let absoluteError =
            0;

          let alphaSamples =
            0;

          const frameIou:
            number[] =
              [];

          for (
            let frame = 0;
            frame <
            alphaFrames.length;
            frame += 1
          ) {
            const alpha =
              alphaFrames[
                frame
              ];

            const reference =
              referenceAlphaFrames[
                frame
              ];

            if (
              alpha ===
                undefined ||
              reference ===
                undefined ||
              alpha.length !==
                reference.length
            ) {
              throw new Error(
                "Tracking-cadence alpha frames do not align.",
              );
            }

            let intersection =
              0;

            let union =
              0;

            for (
              let pixel = 0;
              pixel <
              alpha.length;
              pixel += 1
            ) {
              const actual =
                alpha[
                  pixel
                ] ??
                0;

              const expectedAlpha =
                reference[
                  pixel
                ] ??
                0;

              absoluteError +=
                Math.abs(
                  actual -
                    expectedAlpha,
                );

              alphaSamples +=
                1;

              const actualForeground =
                actual >=
                128;

              const expectedForeground =
                expectedAlpha >=
                128;

              if (
                actualForeground &&
                expectedForeground
              ) {
                intersection +=
                  1;
              }

              if (
                actualForeground ||
                expectedForeground
              ) {
                union +=
                  1;
              }
            }

            frameIou.push(
              union ===
                0
                ? 1
                : intersection /
                  union,
            );
          }

          referenceMaskMeanAbsoluteError =
            absoluteError /
            (
              alphaSamples *
              255
            );

          referenceMaskMeanIou =
            frameIou.reduce(
              (
                total,
                value,
              ) =>
                total +
                value,
              0,
            ) /
            frameIou.length;

          referenceMaskWorstIou =
            Math.min(
              ...frameIou,
            );
        }
      }

      let davisMeanIou:
        number |
        undefined;

      let davisWorstIou:
        number |
        undefined;

      let davisMeanBoundaryF:
        number |
        undefined;

      let davisWorstBoundaryF:
        number |
        undefined;

      if (
        (
          name ===
            "bear" ||
          name ===
            "bmx-trees"
        ) &&
        frameRate ===
          "source" &&
        cadenceTruths !==
          undefined
      ) {
        const scores =
          alphaFrames
            .slice(
              0,
              cadenceTruths.length,
            )
            .map(
              (
                alpha,
                index,
              ) => {
                const truth =
                  cadenceTruths[
                    index
                  ];

                if (
                  truth ===
                  undefined
                ) {
                  throw new Error(
                    `Missing DAVIS cadence truth frame ${index}.`,
                  );
                }

                const predicted =
                  Uint8Array.from(
                    {
                      length:
                        truth.width *
                        truth.height,
                    },
                    (
                      _,
                      pixel,
                    ) => {
                      const x =
                        Math.min(
                          result.width -
                            1,
                          Math.floor(
                            (
                              pixel %
                              truth.width
                            ) *
                              result.width /
                              truth.width,
                          ),
                        );

                      const y =
                        Math.min(
                          result.height -
                            1,
                          Math.floor(
                            Math.floor(
                              pixel /
                              truth.width,
                            ) *
                              result.height /
                              truth.height,
                          ),
                        );

                      return (
                        alpha[
                          y *
                            result.width +
                            x
                        ] ??
                        0
                      ) >=
                      128
                        ? 1
                        : 0;
                    },
                  );

                return {
                  iou:
                    binaryMaskIou(
                      predicted,
                      truth.mask,
                    ),
                  boundaryF:
                    davisBoundaryF(
                      predicted,
                      truth.mask,
                      truth.width,
                      truth.height,
                    ),
                };
              },
            );

        davisMeanIou =
          scores.reduce(
            (
              total,
              score,
            ) =>
              total +
              score.iou,
            0,
          ) /
          scores.length;

        davisWorstIou =
          Math.min(
            ...scores.map(
              (
                score,
              ) =>
                score.iou,
            ),
          );

        davisMeanBoundaryF =
          scores.reduce(
            (
              total,
              score,
            ) =>
              total +
              score.boundaryF,
            0,
          ) /
          scores.length;

        davisWorstBoundaryF =
          Math.min(
            ...scores.map(
              (
                score,
              ) =>
                score.boundaryF,
            ),
          );

        if (
          name ===
            "bear" &&
          configuration.trackingFrameRate ===
            undefined &&
          (
            davisMeanIou <
              0.85 ||
            davisMeanBoundaryF <
              0.85
          )
        ) {
          throw new Error(
            `Full-cadence bear quality regressed: IoU ${davisMeanIou.toFixed(3)}, boundary F ${davisMeanBoundaryF.toFixed(3)}.`,
          );
        }
      }

      cases.push({
        frameRate,
        trackingFrameRate:
          configuration.trackingFrameRate,
        frames: result.frameCount,
        trackingFrames:
          result.trackingFrameCount,
        outputFps: result.sampleFps,
        processingFps: result.frameCount / (totalMs / 1000),
        trackingFps: Math.max(0, result.trackingFrameCount - 1) / (result.timings.trackingMs / 1000),
        totalMs, stages, bytes: result.blob.size, width: result.width, height: result.height,
        decodedDuration: decoded.duration, rgbSum, psnr: 10 * Math.log10(255 ** 2 / mse),
        referenceMaskMeanAbsoluteError,
        referenceMaskMeanIou,
        referenceMaskWorstIou,
        davisMeanIou,
        davisWorstIou,
        davisMeanBoundaryF,
        davisWorstBoundaryF,
        timestamps: decoded.timestamps, timings: result.timings,
      });
    }

    // Compare unchanged single-frame segmentation against DAVIS rather than inventing smoothing.
    let quality;

    if (name === "bear") {
      const masks = await editor.preview(0, subjects, new AbortController().signal);
      const mask = masks[0];
      const bitmap = await createImageBitmap(await fetch("/quality/bear/00000.png").then((response) => response.blob()));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");

      if (mask === undefined || context === null) throw new Error("Missing quality input.");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const truth = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const expected = Uint8Array.from({ length: canvas.width * canvas.height }, (_, index) => (truth[index * 4] ?? 0) > 0 ? 1 : 0);

      const predicted = Uint8Array.from(expected, (_, index) => {
        const x = Math.floor(index % canvas.width * mask.width / canvas.width);
        const y = Math.floor(Math.floor(index / canvas.width) * mask.height / canvas.height);

        return (mask.alpha[y * mask.width + x] ?? 0) > 0 ? 1 : 0;
      });

      quality = { iou: binaryMaskIou(predicted, expected), boundaryF: davisBoundaryF(predicted, expected, canvas.width, canvas.height) };
    }

    return {
      name,
      modelMs,
      modelMilestones,
      frameWarmMs,
      framePreparation,
      coldSelectionReadyMs:
        modelMs +
        frameWarmMs,
      firstClickMs,
      warmClickMs,
      cases,
      quality,
    };
  } finally {
    await editor.close();
  }
};

const main = async () => {
  const reports = [];

  let bearFile:
    File |
    undefined;

  for (const name of ["bear", "bmx-trees"] as const) {
    const file = new File([await fetch(`/quality/${name}.mp4`).then((response) => response.blob())], `${name}.mp4`);

    if (
      name ===
      "bear"
    ) {
      bearFile =
        file;
    }

    const points = name === "bear"
      ? [{ x: 0.4, y: 0.65, label: 1 as const }]
      : [{ x: 0.531615925058548, y: 0.49375, label: 1 as const }, { x: 0.5011709601873536, y: 0.6895833333333333, label: 1 as const }];

    reports.push(await benchmark(name, file, points));
  }

  if (
    bearFile ===
    undefined
  ) {
    throw new Error(
      "Bear tracker benchmark fixture is unavailable.",
    );
  }

  const promptTrackerCases =
    [];

  for (
    const candidateId of
    [
      "sam21-tiny",
      "edgetam",
    ] as const
  ) {
    promptTrackerCases.push(
      await benchmarkPromptTracker(
        bearFile,
        candidateId,
        {
          x: 0.4,
          y: 0.65,
          label: 1,
        },
      ),
    );
  }

  reports.push({
    name:
      "prompt-trackers",
    cases:
      promptTrackerCases,
  });

  const sixty = await generatedSixty();
  await save("genuine-sixty-input.mp4", sixty);
  reports.push(await benchmark("sixty", sixty, [{ x: 0.18, y: 0.5, label: 1 }]));
  reports.push(await benchmarkVfrNonzero());
  await fetch("/result", { method: "POST", body: JSON.stringify({ reports }) });
};

void main().catch((error) => fetch("/failure", {
  method: "POST", body: JSON.stringify({ message: String(error), stack: error instanceof Error ? error.stack : "" }),
}));
