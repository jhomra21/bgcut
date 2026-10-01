import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import packageJson from "../package.json";

const token = (...parts: readonly string[]): string => parts.join("");

const removed = {
  catchAll: token("Effect", "catch", "All"),
  effectEither: token("Effect", "ei", "ther"),
  schemaEitherDecoder: token("Schema", "decodeUnknown", "Ei", "ther"),
  eitherModule: token("Ei", "ther"),
  oldEffectPackagePrefix: token("effect@", "3", "."),
  oldEffectDependencyPrefix: token('"effect": "', "3", "."),
  oldSchemaDependency: token("@standard-schema", "/spec"),
  oldPropertyDependency: token("fast", "-check"),
  oldRandomDependency: token("pure", "-rand"),
  oldVersionName: token("Effect ", "3"),
  oldVersionPhrase: token("Effect", " v3"),
};

const repositoryTextPaths = [
  ...new Bun.Glob("**/*.{ts,tsx,js,mjs,cjs,json,md,yml,yaml}").scanSync("."),
].filter(
  (path) =>
    !path.startsWith("node_modules/") &&
    !path.startsWith("dist/") &&
    !path.startsWith(".git/"),
);

describe("Effect 4 repository contract", () => {
  test("pins the stable Effect 4 package without old lockfile baggage", async () => {
    const lock = await readFile("bun.lock", "utf8");

    expect(packageJson.dependencies.effect).toBe("4.0.0");
    expect(lock).toContain('"effect": "4.0.0"');
    expect(lock).toContain('"effect": ["effect@4.0.0"');
    expect(lock).not.toContain(removed.oldEffectPackagePrefix);
    expect(lock).not.toContain(removed.oldEffectDependencyPrefix);
    expect(lock).not.toContain(removed.oldSchemaDependency);
    expect(lock).not.toContain(removed.oldPropertyDependency);
    expect(lock).not.toContain(removed.oldRandomDependency);
  });

  test("contains no removed Effect 3 APIs or version references in repository text", async () => {
    const removedEitherImport = new RegExp(
      `import\\s+\\{[^}]*\\b${removed.eitherModule}\\b[^}]*\\}\\s+from\\s+["']effect["']`,
      "u",
    );

    for (const path of repositoryTextPaths) {
      const text = await readFile(path, "utf8");

      expect(text, path).not.toContain(removed.catchAll);
      expect(text, path).not.toContain(removed.effectEither);
      expect(text, path).not.toContain(removed.schemaEitherDecoder);
      expect(text, path).not.toContain(removed.oldEffectPackagePrefix);
      expect(text, path).not.toContain(removed.oldEffectDependencyPrefix);
      expect(text, path).not.toContain(removed.oldVersionName);
      expect(text, path).not.toContain(removed.oldVersionPhrase);
      expect(text, path).not.toMatch(removedEitherImport);
    }
  });
});
