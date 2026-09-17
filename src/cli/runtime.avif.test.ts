import { expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { MODEL_INPUT_SIZE } from "../engine/image";
import { prepareImage } from "./runtime";

test("prepareImage decodes AVIF by content even when the filename ends in .jpg", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bgcut-avif-input-"));

  try {
    const inputPath = join(directory, "mislabeled.jpg");

    await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 24, g: 96, b: 180 },
      },
    })
      .avif({ lossless: true })
      .toFile(inputPath);

    const prepared = await Effect.runPromise(prepareImage(inputPath));

    expect(prepared.width).toBe(3);
    expect(prepared.height).toBe(2);
    expect(prepared.source.length).toBe(3 * 2 * 4);
    expect(prepared.modelInput.length).toBe(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
