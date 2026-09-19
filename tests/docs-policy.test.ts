import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const writingSources = [
  "README.md",
  "docs/operations/releasing.md",
  "docs/operations/deploying.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "docs/engineering/benchmarks.md",
  "docs/engineering/graph-capture.md",
  "docs/roadmap.md",
  "skills/bgcut/SKILL.md",
  "tools/oxlint/anti-slop/UPSTREAM.md",
  "src/app/App.tsx",
] as const;

const readWritingSources = async (): Promise<readonly [string, string][]> =>
  Promise.all(writingSources.map(async (path) => [path, await readFile(path, "utf8")] as const));

describe("repository documentation", () => {
  test("does not name internal comparison tools", async () => {
    const forbiddenName = ["b", "g", "0"].join("");

    for (const [path, content] of await readWritingSources()) {
      expect(content.toLowerCase(), path).not.toContain(forbiddenName);
    }
  });

  test("uses plain ASCII punctuation for dashes and quotes", async () => {
    for (const [path, content] of await readWritingSources()) {
      expect(content, path).not.toMatch(/[\u2013\u2014\u201c\u201d]/u);
    }
  });
});
