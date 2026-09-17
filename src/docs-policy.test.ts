import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const publicDocs = [
  "README.md",
  "RELEASING.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "BENCHMARKS.md",
  "GRAPH_CAPTURE.md",
  "IMPROVEMENTS.md",
  "skills/bgcut/SKILL.md",
] as const;

const readDocs = async (): Promise<readonly [string, string][]> =>
  Promise.all(publicDocs.map(async (path) => [path, await readFile(path, "utf8")] as const));

describe("public documentation", () => {
  test("does not name internal comparison tools", async () => {
    const forbiddenName = ["b", "g", "0"].join("");

    for (const [path, content] of await readDocs()) {
      expect(content.toLowerCase(), path).not.toContain(forbiddenName);
    }
  });

  test("does not use typographic dash or curly quote characters", async () => {
    for (const [path, content] of await readDocs()) {
      expect(content, path).not.toMatch(/[\u2013\u2014\u201c\u201d]/u);
    }
  });
});
