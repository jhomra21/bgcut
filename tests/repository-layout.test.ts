import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const lowerLayerSources = [
  "src/cli/runtime.ts",
  "src/cli/server.ts",
  "src/node/index.ts",
  "src/node/runtime.ts",
  "src/native/alpha-mask.ts",
  "src/native/model-cache.ts",
  "src/worker/index.ts",
] as const;

describe("repository dependency direction", () => {
  test("keeps Node and native code independent from the CLI layer", async () => {
    for (const path of lowerLayerSources) {
      const source = await readFile(path, "utf8");

      if (path.startsWith("src/node/") || path.startsWith("src/native/")) {
        expect(source, path).not.toMatch(/from\s+["']\.\.\/cli\//u);
      }
    }
  });

  test("keeps browser code out of native, CLI, and Worker layers", async () => {
    for (const path of lowerLayerSources) {
      const source = await readFile(path, "utf8");

      expect(source, path).not.toMatch(/from\s+["'][^"']*browser\//u);
    }
  });
});
