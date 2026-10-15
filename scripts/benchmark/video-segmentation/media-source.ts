import {
  ALL_FORMATS,
  BlobSource,
  Input,
  VideoSampleSink,
  EncodedPacketSink,
  type InputVideoTrack,
} from "mediabunny";

import type {
  DecodedVideoFrame,
  VideoFrameSource,
  VideoSourceInfo,
} from "./types";
import { selectVideoTimestamps } from "../../../src/shared/video-timeline";

const primaryVideoInfo = async (track: InputVideoTrack): Promise<VideoSourceInfo> => {
  const firstTimestamp = Math.max(0, await track.getFirstTimestamp());
  const endTimestamp = await track.computeDuration({ skipLiveWait: true });

  return {
    width: await track.getDisplayWidth(),
    height: await track.getDisplayHeight(),
    firstTimestamp,
    // MediaBunny's duration API returns an absolute end timestamp, not an elapsed span.
    duration: endTimestamp - firstTimestamp,
  };
};

export const readVideoSourceInfo = async (file: Blob): Promise<VideoSourceInfo> => {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  try {
    const track = await input.getPrimaryVideoTrack();

    if (track === null) {
      throw new Error("This file has no primary video track.");
    }

    return await primaryVideoInfo(track);
  } finally {
    input.dispose();
  }
};

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

    const info = await primaryVideoInfo(track);
    const sink = new VideoSampleSink(track);

    return {
      info,

      async frameTimes(start, end, maxFps, signal) {
        const packets = new EncodedPacketSink(track);
        const options = { metadataOnly: true };
        const first = await packets.getKeyPacket(start, options);
        const lastKey = await packets.getKeyPacket(end, options);
        const after = lastKey === null ? null : await packets.getNextKeyPacket(lastKey, options);
        const timestamps: number[] = [];

        for await (const packet of packets.packets(first ?? undefined, after ?? undefined, options)) {
          signal?.throwIfAborted();

          if (packet.timestamp > start && packet.timestamp < end) timestamps.push(packet.timestamp);
        }

        return selectVideoTimestamps(timestamps, start, end, maxFps);
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
