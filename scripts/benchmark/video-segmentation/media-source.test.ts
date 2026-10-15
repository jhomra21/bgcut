import { expect, test } from "bun:test";
import {
  BufferTarget, EncodedPacket, EncodedVideoPacketSource, Output, WebMOutputFormat,
} from "mediabunny";

import { readVideoSourceInfo } from "./media-source";
import { planVideoExport } from "../../../src/browser/video-export";

test("primary-video timeline is an elapsed span, not the last packet timestamp", async () => {
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new EncodedVideoPacketSource("vp8");
  output.addVideoTrack(source, { frameRate: 1 });
  await output.start();

  // A keyframe header is sufficient for mux/demux metadata; this test never decodes pixels.
  const header = new Uint8Array([0x10, 0, 0, 0x9d, 0x01, 0x2a, 16, 0, 16, 0]);
  await source.add(new EncodedPacket(header, "key", 2, 1), {
    decoderConfig: { codec: "vp8", codedWidth: 16, codedHeight: 16 },
  });
  await source.add(new EncodedPacket(header, "key", 3, 1));
  source.close();
  await output.finalize();

  if (target.buffer === null) throw new Error("Missing test container.");

  const info = await readVideoSourceInfo(new Blob([target.buffer]));
  expect(info.firstTimestamp).toBe(2);
  expect(info.duration).toBe(2);
  const plan = planVideoExport(info, { start: 0, end: info.duration });
  expect(plan.duration).toBe(2);
  expect(plan.maxFps).toBe(60);
  expect(() => planVideoExport(info, { start: 0, end: 2.001 })).toThrow();
});
