import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const entryNames = async (path: string): Promise<readonly string[]> => {
  const entries = await readdir(path, { withFileTypes: true });

  return entries.map((entry) => entry.name).sort();
};

const sourceFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...await sourceFiles(path));

      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(path);
    }
  }

  return files;
};

const expectNoBoundaryImports = async (
  directory: string,
  forbiddenBoundaries: readonly string[],
): Promise<void> => {
  for (const path of await sourceFiles(directory)) {
    const source = await Bun.file(path).text();

    for (const boundary of forbiddenBoundaries) {
      expect(source, `${path} must not import from src/${boundary}`).not.toContain(
        `/${boundary}/`,
      );
    }
  }
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

  test("keeps dependency direction aligned with source ownership", async () => {
    await expectNoBoundaryImports("src/app", ["cli", "native", "node"]);
    await expectNoBoundaryImports("src/engine", ["app", "cli", "native", "node"]);
    await expectNoBoundaryImports("src/cli", ["app", "engine"]);
    await expectNoBoundaryImports("src/node", ["app", "cli", "engine"]);
    await expectNoBoundaryImports("src/native", ["app", "cli", "engine", "node"]);
    await expectNoBoundaryImports("src/shared", ["app", "cli", "engine", "native", "node"]);
  });
});
