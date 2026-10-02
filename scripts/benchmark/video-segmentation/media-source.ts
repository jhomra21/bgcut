import {
  ALL_FORMATS,
  BlobSource,
  Input,
  VideoSampleSink,
} from "mediabunny";

import type {
  DecodedVideoFrame,
  VideoFrameSource,
} from "./types";

const decodedFrame = (
  sample: Awaited<ReturnType<VideoSampleSink["getSample"]>>,
  decodeMs: number,
): DecodedVideoFrame | null => {
  if (sample === null) {
    return null;
  }

  const frame = sample.toVideoFrame();
  let closed = false;

  return {
    frame,
    timestamp: sample.timestamp,
    decodeMs,
    close() {
      if (closed) {
        return;
      }

      closed = true;
      frame.close();
      sample.close();
    },
  };
};

export const openMediaBunnyVideoSource = async (
  file: Blob,
): Promise<VideoFrameSource> => {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });

  try {
    const track = await input.getPrimaryVideoTrack();

    if (track === null) {
      throw new Error("The benchmark input has no video track.");
    }

    if (!(await track.canDecode())) {
      throw new Error("The browser cannot decode the benchmark video track.");
    }

    const firstTimestamp = await track.getFirstTimestamp();

    const duration =
      (await input.getDurationFromMetadata([track], {
        skipLiveWait: true,
      })) ??
      (await input.computeDuration([track], {
        skipLiveWait: true,
      }));

    const sink = new VideoSampleSink(track);

    return {
      info: {
        width: await track.getDisplayWidth(),
        height: await track.getDisplayHeight(),
        firstTimestamp,
        duration,
      },

      async frameAt(timestamp) {
        const startedAt = performance.now();
        const sample = await sink.getSample(timestamp);

        return decodedFrame(
          sample,
          performance.now() - startedAt,
        );
      },

      async *framesAt(timestamps) {
        const iterator = sink.samplesAtTimestamps(timestamps)[Symbol.asyncIterator]();

        try {
          for (;;) {
            const startedAt = performance.now();
            const next = await iterator.next();

            if (next.done) {
              return;
            }

            yield decodedFrame(
              next.value,
              performance.now() - startedAt,
            );
          }
        } finally {
          await iterator.return?.();
        }
      },

      close() {
        input.dispose();
      },
    };
  } catch (error) {
    input.dispose();
    throw error;
  }
};
