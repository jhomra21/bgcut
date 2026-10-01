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
};

const sourcePaths = [
  ...new Bun.Glob("src/**/*.{ts,tsx}").scanSync("."),
  ...new Bun.Glob("scripts/**/*.ts").scanSync("."),
  ...new Bun.Glob("tools/**/*.ts").scanSync("."),
];

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

  test("uses the Effect 4 error and schema APIs throughout runtime sources", async () => {
    const removedEitherImport = new RegExp(
      `import\\s+\\{[^}]*\\b${removed.eitherModule}\\b[^}]*\\}\\s+from\\s+["']effect["']`,
      "u",
    );

    for (const path of sourcePaths) {
      const source = await readFile(path, "utf8");

      expect(source, path).not.toContain(removed.catchAll);
      expect(source, path).not.toContain(removed.effectEither);
      expect(source, path).not.toContain(removed.schemaEitherDecoder);
      expect(source, path).not.toMatch(removedEitherImport);
    }
  });
});
