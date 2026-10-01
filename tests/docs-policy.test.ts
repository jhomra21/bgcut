import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import packageJson from "../package.json";

const writingSources = [
  "README.md",
  "docs/README.md",
  "docs/operations/releasing.md",
  "docs/operations/deploying.md",
  "docs/operations/search-console.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "docs/engineering/benchmarks.md",
  "docs/engineering/graph-capture.md",
  "docs/roadmap.md",
  "skills/bgcut/SKILL.md",
  "public/llms.txt",
  "tools/oxlint/anti-slop/UPSTREAM.md",
  "src/app/App.tsx",
  "src/app/components/SiteChrome.tsx",
  "src/app/components/GuideVisual.tsx",
  "src/app/pages/HomePage.tsx",
  "src/app/pages/ChangelogPage.tsx",
  "src/app/pages/DocsPage.tsx",
  "src/app/pages/PrivacyPage.tsx",
  "src/app/pages/TermsPage.tsx",
  "src/shared/guides.ts",
] as const;

const userFacingSources = [
  "README.md",
  "public/llms.txt",
  "skills/bgcut/SKILL.md",
  "src/app/App.tsx",
  "src/app/components/CodeBlock.tsx",
  "src/app/components/GuideVisual.tsx",
  "src/app/components/ContentBreadcrumb.tsx",
  "src/app/components/ReferencePage.tsx",
  "src/app/components/ResourceNavRail.tsx",
  "src/app/components/ResourcePage.tsx",
  "src/app/components/SectionRail.tsx",
  "src/app/components/SiteChrome.tsx",
  "src/app/pages/ChangelogPage.tsx",
  "src/app/pages/ComparisonPage.tsx",
  "src/app/pages/DocsPage.tsx",
  "src/app/pages/GuidePage.tsx",
  "src/app/pages/HomePage.tsx",
  "src/app/pages/IntentPage.tsx",
  "src/app/pages/PrivacyPage.tsx",
  "src/app/pages/TermsPage.tsx",
  "src/app/pages/ToolPage.tsx",
  "src/shared/comparisons.ts",
  "src/shared/guides.ts",
  "src/shared/intent-pages.ts",
  "src/shared/resource-navigation.ts",
  "src/shared/site-metadata.ts",
  "src/shared/tools.ts",
] as const;

const versionedDocumentationSources = [
  "README.md",
  "docs/README.md",
  "public/llms.txt",
  "skills/bgcut/SKILL.md",
  "src/app/pages/DocsPage.tsx",
] as const;

const readSources = async (
  paths: readonly string[],
): Promise<readonly [string, string][]> =>
  Promise.all(paths.map(async (path) => [path, await readFile(path, "utf8")] as const));

const readWritingSources = async (): Promise<readonly [string, string][]> =>
  readSources(writingSources);

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

  test("keeps public docs on the base release without prerelease labels", async () => {
    const baseVersion = packageJson.version.split("-", 1)[0] ?? packageJson.version;
    expect(baseVersion).toMatch(/^\d+\.\d+\.\d+$/u);

    for (const [path, content] of await readSources(userFacingSources)) {
      expect(content, path).not.toMatch(/\bbeta\b/iu);

      if (packageJson.version !== baseVersion) {
        expect(content, path).not.toContain(packageJson.version);
      }
    }

    for (const [path, content] of await readSources(versionedDocumentationSources)) {
      expect(content, path).toContain(baseVersion);

      if (packageJson.version !== baseVersion) {
        expect(content, path).not.toContain(packageJson.version);
      }
    }
  });
});
