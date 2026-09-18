import { expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectModelFile } from "./model-file";

test("model file inspection returns size and SHA-256", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bgcut-model-file-"));
  const path = join(directory, "model.bin");

  try {
    await writeFile(path, "bgcut node model inspection\n");

    expect(await Effect.runPromise(inspectModelFile(path))).toEqual({
      sizeBytes: 28,
      sha256: "ec07a24595fb74d7579ae954d1a6ea66394290e1c0907e3d8ae44efa3e9f00c9",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("model file inspection returns undefined for a missing path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bgcut-model-file-missing-"));

  try {
    expect(
      await Effect.runPromise(inspectModelFile(join(directory, "missing.onnx"))),
    ).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
