import { describe, expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();

const sourceRoot = join(root, "src");

type Boundary = {
  readonly directory: string;
  readonly forbiddenImports: readonly string[];
};

const boundaries: readonly Boundary[] = [
  {
    directory: "core",
    forbiddenImports: ["../app", "../browser", "../cli", "../native", "../node"],
  },
  {
    directory: "browser",
    forbiddenImports: ["../app", "../cli", "../native", "../node"],
  },
  {
    directory: "native",
    forbiddenImports: ["../app", "../browser", "../cli", "../node"],
  },
  {
    directory: "cli",
    forbiddenImports: ["../app", "../browser", "../node"],
  },
  {
    directory: "node",
    forbiddenImports: ["../app", "../browser", "../cli"],
  },
];

const collectSourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(path));

      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(path);
    }
  }

  return files;
};

const importsForbiddenPath = (source: string, prefix: string): boolean =>
  source.includes(`from "${prefix}`) ||
  source.includes(`from '${prefix}`) ||
  source.includes(`import("${prefix}`) ||
  source.includes(`import('${prefix}`);

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
};

describe("repository source boundaries", () => {
  for (const boundary of boundaries) {
    test(`${boundary.directory} keeps one-way dependencies`, async () => {
      const directory = join(sourceRoot, boundary.directory);
      const files = await collectSourceFiles(directory);
      const violations: string[] = [];

      for (const file of files) {
        const source = await readFile(file, "utf8");

        for (const prefix of boundary.forbiddenImports) {
          if (importsForbiddenPath(source, prefix)) {
            violations.push(`${relative(root, file)} imports ${prefix}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  }

  test("does not recreate the old generic engine directory", async () => {
    expect(await pathExists(join(sourceRoot, "engine"))).toBe(false);
  });

  test("keeps the Cloudflare worker out of browser and native implementation details", async () => {
    const source = await readFile(join(root, "worker", "index.ts"), "utf8");

    expect(source).not.toContain("../src/browser/");
    expect(source).not.toContain("../src/native/");
    expect(source).not.toContain("../src/cli/");
    expect(source).not.toContain("../src/node/");
  });
});
