import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, relative, sep } from "node:path";

const SOURCE_LAYERS = ["app", "browser", "cli", "native", "node", "core"] as const;

type SourceLayer = (typeof SOURCE_LAYERS)[number];

const isSourceLayer = (value: string): value is SourceLayer =>
  SOURCE_LAYERS.some((candidate) => candidate === value);

const allowedImports = new Map<SourceLayer, ReadonlySet<SourceLayer>>([
  ["app", new Set(["app", "browser", "core"])],
  ["browser", new Set(["browser", "core"])],
  ["cli", new Set(["cli", "native", "core"])],
  ["native", new Set(["native", "core"])],
  ["node", new Set(["node", "native", "core"])],
  ["core", new Set(["core"])],
]);

const importPattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/gu;

const listTypeScriptFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listTypeScriptFiles(path));
      continue;
    }

    if (entry.isFile() && (path.endsWith(".ts") || path.endsWith(".tsx"))) {
      files.push(path);
    }
  }

  return files;
};

const layerForPath = (path: string): SourceLayer | undefined => {
  const normalizedPath = path.split(sep).join("/");
  const parts = normalizedPath.split("/");
  const candidate = parts[1];

  return candidate !== undefined && isSourceLayer(candidate) ? candidate : undefined;
};

const importedLayer = (
  sourcePath: string,
  specifier: string,
): SourceLayer | undefined => {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const resolved = relative(".", normalize(join(dirname(sourcePath), specifier)));

  return layerForPath(resolved);
};

describe("repository source boundaries", () => {
  test("keeps the expected source layers explicit", async () => {
    const entries = await readdir("src", { withFileTypes: true });
    const layers: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        layers.push(entry.name);
      }
    }

    expect(layers.sort()).toEqual([...SOURCE_LAYERS].sort());
  });

  test("keeps imports moving toward core runtime layers", async () => {
    const files = await listTypeScriptFiles("src");

    for (const file of files) {
      const sourceLayer = layerForPath(file);

      if (sourceLayer === undefined) {
        throw new Error(`Unexpected source file outside a known layer: ${file}`);
      }

      const source = await readFile(file, "utf8");
      const allowed = allowedImports.get(sourceLayer);

      if (allowed === undefined) {
        throw new Error(`No dependency rule exists for source layer ${sourceLayer}.`);
      }

      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];

        if (specifier === undefined) {
          continue;
        }

        const targetLayer = importedLayer(file, specifier);

        if (targetLayer === undefined) {
          continue;
        }

        expect(
          allowed.has(targetLayer),
          `${file} must not import ${specifier}; ${sourceLayer} may depend on ${[...allowed].join(", ")}.`,
        ).toBe(true);
      }
    }
  });
});
