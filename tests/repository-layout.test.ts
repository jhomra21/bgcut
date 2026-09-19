import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const lowerLayerSources = [
  "src/node/index.ts",
  "src/node/runtime.ts",
  "src/native/alpha-mask.ts",
  "src/native/model-cache.ts",
] as const;

describe("repository dependency direction", () => {
  test("keeps Node and native code independent from the CLI layer", async () => {
    for (const path of lowerLayerSources) {
      const source = await readFile(path, "utf8");

      expect(source, path).not.toMatch(/from\s+["']\.\.\/cli\//u);
    }
  });
});
