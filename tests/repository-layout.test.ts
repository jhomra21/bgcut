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

  test("keeps the Solid app independent from native command surfaces", async () => {
    const source = await Bun.file("src/app/App.tsx").text();

    expect(source).not.toContain("../cli/");
    expect(source).not.toContain("../node/");
  });
});
