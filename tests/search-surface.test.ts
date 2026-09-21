import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const [
  indexHtml,
  metadataSource,
  routeBuilderSource,
  homeSource,
  styles,
  sitemap,
  llms,
  packageSource,
  packagePrepareSource,
] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("src/shared/site-metadata.ts", "utf8"),
  readFile("scripts/site/prepare-static-routes.ts", "utf8"),
  readFile("src/app/pages/HomePage.tsx", "utf8"),
  readFile("src/app/styles.css", "utf8"),
  readFile("public/sitemap.xml", "utf8"),
  readFile("public/llms.txt", "utf8"),
  readFile("package.json", "utf8"),
  readFile("scripts/package/prepare.ts", "utf8"),
]);

const relativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );

  const linear = channels.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  );

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrastRatio = (foreground: string, background: string): number => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));

  return (lighter + 0.05) / (darker + 0.05);
};

describe("search and Lighthouse surface", () => {
  test("publishes descriptive root metadata and software application schema", () => {
    expect(indexHtml).toContain("<title>Free Background Remover - Private & Local | bgcut</title>");
    expect(indexHtml).toContain('rel="canonical" href="https://bgcut.dev/"');
    expect(indexHtml).toContain('"@type": "WebApplication"');
    expect(indexHtml).toContain('"applicationCategory": "DesignApplication"');
    expect(indexHtml).toContain('"price": "0"');
  });

  test("defines distinct metadata for every hosted route", () => {
    expect(metadataSource).toContain('path: "/docs"');
    expect(metadataSource).toContain('path: "/changelog"');
    expect(metadataSource).toContain('path: "/privacy"');
    expect(metadataSource).toContain('path: "/terms"');
    expect(metadataSource).toContain("bgcut Docs - Browser, CLI and Node.js Background Removal");
    expect(metadataSource).toContain("bgcut Changelog - Releases and API Changes");
    expect(metadataSource.match(/index: false/gu)?.length).toBe(2);
    expect(routeBuilderSource).toContain('"docs", "changelog", "privacy", "terms"');
  });

  test("keeps the sitemap focused on pages intended for Google Search", () => {
    expect(sitemap).toContain("<loc>https://bgcut.dev/</loc>");
    expect(sitemap).toContain("<loc>https://bgcut.dev/docs</loc>");
    expect(sitemap).toContain("<loc>https://bgcut.dev/changelog</loc>");
    expect(sitemap).not.toContain("<loc>https://bgcut.dev/privacy</loc>");
    expect(sitemap).not.toContain("<loc>https://bgcut.dev/terms</loc>");
  });

  test("publishes a simple agent discovery file without treating it as SEO", () => {
    expect(llms.startsWith("# bgcut\n")).toBe(true);
    expect(llms).toContain("[Background remover](https://bgcut.dev/)");
    expect(llms).toContain("[Documentation](https://bgcut.dev/docs)");
    expect(llms).toContain("[Changelog](https://bgcut.dev/changelog)");
  });

  test("defers the heavy browser processing stack until image selection", () => {
    expect(homeSource).toContain('import("../../browser/actions")');
    expect(homeSource).not.toContain('from "../../browser/inference"');
    expect(homeSource).not.toContain('from "effect"');
  });

  test("keeps normal secondary text above WCAG AA contrast on the site canvas", () => {
    const match = styles.match(/--ink-soft:\s*(#[0-9a-f]{6})/u);

    expect(match?.[1]).toBeDefined();
    expect(contrastRatio(match?.[1] ?? "#000000", "#fbfbfa")).toBeGreaterThanOrEqual(4.5);
  });

  test("generates hosted metadata routes without adding them to the packaged local app", () => {
    expect(packageSource).toContain('"site:prepare-routes"');
    expect(packageSource).toContain("vite build --mode cloudflare && bun run site:prepare-routes");
    expect(packagePrepareSource).not.toContain("site:prepare-routes");
  });
});
