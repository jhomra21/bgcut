import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const effectPackage = ["effect"].join("");

const removedCatch = ["Effect", "catch", "All"].join(".");
const removedEffectResultName = ["Effect", "ei", "ther"].join(".");
const removedSchemaDecoder = ["Schema", "decodeUnknown", "Ei", "ther"].join(".");
const removedEitherModule = ["Ei", "ther"].join("");
const oldEffectPackagePrefix = ["effect@", "3", "."].join("");
const oldEffectDependencyPrefix = ['"effect": "', "3", "."].join("");
const oldSchemaDependency = ["@standard-schema", "/spec"].join("");
const oldPropertyDependency = ["fast", "-check"].join("");
const oldRandomDependency = ["pure", "-rand"].join("");

const sourcePaths = [
  ...new Bun.Glob("src/**/*.{ts,tsx}").scanSync("."),
  ...new Bun.Glob("scripts/**/*.ts").scanSync("."),
  ...new Bun.Glob("tools/**/*.ts").scanSync("."),
];

describe("Effect 4 repository contract", () => {
  test("pins the stable Effect 4 package without old lockfile baggage", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const lock = await readFile("bun.lock", "utf8");

    expect(packageJson.dependencies?.[effectPackage]).toBe("4.0.0");
    expect(lock).toContain('"effect": "4.0.0"');
    expect(lock).toContain('"effect": ["effect@4.0.0"');
    expect(lock).not.toContain(oldEffectPackagePrefix);
    expect(lock).not.toContain(oldEffectDependencyPrefix);
    expect(lock).not.toContain(oldSchemaDependency);
    expect(lock).not.toContain(oldPropertyDependency);
    expect(lock).not.toContain(oldRandomDependency);
  });

  test("uses the Effect 4 error and schema APIs throughout runtime sources", async () => {
    const removedEitherImport = new RegExp(
      `import\\s+\\{[^}]*\\b${removedEitherModule}\\b[^}]*\\}\\s+from\\s+["']effect["']`,
      "u",
    );

    for (const path of sourcePaths) {
      const source = await readFile(path, "utf8");

      expect(source, path).not.toContain(removedCatch);
      expect(source, path).not.toContain(removedEffectResultName);
      expect(source, path).not.toContain(removedSchemaDecoder);
      expect(source, path).not.toMatch(removedEitherImport);
    }
  });
});
