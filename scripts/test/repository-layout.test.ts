import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);

    return true;
  } catch {
    return false;
  }
};

describe("repository layout", () => {
  test("keeps runtime and tooling boundaries explicit", async () => {
    const expectedPaths = [
      "src/app/App.tsx",
      "src/app/main.tsx",
      "src/engine/inference.ts",
      "src/cli/main.ts",
      "src/node/index.ts",
      "src/shared/model-file.ts",
      "src/worker/index.ts",
      "scripts/build/npm-package.ts",
      "scripts/cloudflare/runtime-smoke.ts",
      "scripts/test/package-smoke.ts",
      "scripts/shared/model-file.ts",
      "docs/engineering/benchmarks.md",
      "docs/operations/deploying.md",
      "docs/README.md",
    ] as const;

    for (const path of expectedPaths) {
      expect(await exists(path)).toBe(true);
    }
  });

  test("does not reintroduce the old flat layout", async () => {
    const legacyPaths = [
      "src/App.tsx",
      "src/main.tsx",
      "src/styles.css",
      "src/components",
      "worker/index.ts",
      "scripts/package-smoke.ts",
      "scripts/cloudflare-runtime-smoke.ts",
      "scripts/upload-cloudflare-runtime.ts",
      "BENCHMARKS.md",
      "DEPLOYING.md",
      "GRAPH_CAPTURE.md",
      "IMPROVEMENTS.md",
      "RELEASING.md",
    ] as const;

    for (const path of legacyPaths) {
      expect(await exists(path)).toBe(false);
    }
  });

  test("keeps build entry points pointed at the organized tree", async () => {
    const packageSource = await Bun.file("package.json").text();
    const indexSource = await Bun.file("index.html").text();
    const wranglerSource = await Bun.file("wrangler.jsonc").text();

    expect(packageSource).toContain("scripts/build/");
    expect(packageSource).toContain("scripts/cloudflare/");
    expect(packageSource).toContain("scripts/test/package-smoke.ts");
    expect(indexSource).toContain('/src/app/main.tsx');
    expect(wranglerSource).toContain('"main": "src/worker/index.ts"');
  });
});
