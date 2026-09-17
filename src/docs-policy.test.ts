import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const repositoryDocs = [
  "README.md",
  "RELEASING.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "BENCHMARKS.md",
  "GRAPH_CAPTURE.md",
  "IMPROVEMENTS.md",
  "skills/bgcut/SKILL.md",
  "tools/oxlint/anti-slop/UPSTREAM.md",
] as const;

const readDocs = async (): Promise<readonly [string, string][]> =>
  Promise.all(repositoryDocs.map(async (path) => [path, await readFile(path, "utf8")] as const));

describe("repository documentation", () => {
  test("does not name internal comparison tools", async () => {
    const forbiddenName = ["b", "g", "0"].join("");

    for (const [path, content] of await readDocs()) {
      expect(content.toLowerCase(), path).not.toContain(forbiddenName);
    }
  });

  test("uses plain ASCII punctuation for dashes and quotes", async () => {
    for (const [path, content] of await readDocs()) {
      expect(content, path).not.toMatch(/[\u2013\u2014\u201c\u201d]/u);
    }
  });
});
