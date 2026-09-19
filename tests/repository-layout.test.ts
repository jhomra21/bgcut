import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const entryNames = async (path: string): Promise<readonly string[]> => {
  const entries = await readdir(path, { withFileTypes: true });

  return entries.map((entry) => entry.name).sort();
};

describe("repository layout", () => {
  test("keeps source code behind explicit runtime boundaries", async () => {
    expect(await entryNames("src")).toEqual([
      "app",
      "cli",
      "engine",
      "native",
      "node",
      "shared",
    ]);
  });

  test("keeps repository documentation grouped by purpose", async () => {
    expect(await entryNames("docs")).toEqual([
      "README.md",
      "architecture",
      "engineering",
      "images",
      "operations",
    ]);
  });

  test("keeps surface dependencies pointed toward implementation boundaries", async () => {
    const appSource = await Bun.file("src/app/App.tsx").text();
    const nodeSource = await Bun.file("src/node/runtime.ts").text();
    const nativeModelSource = await Bun.file("src/native/model-cache.ts").text();

    expect(appSource).not.toContain("../cli/");
    expect(appSource).not.toContain("../node/");
    expect(nodeSource).not.toContain("../cli/");
    expect(nodeSource).not.toContain("../engine/");
    expect(nativeModelSource).not.toContain("../cli/");
    expect(nativeModelSource).not.toContain("../engine/");
    expect(nativeModelSource).not.toContain("../node/");
  });
});
