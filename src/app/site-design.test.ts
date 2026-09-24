import { describe, expect, test } from "bun:test";

const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text();

const themeSource = await Bun.file(new URL("./theme.ts", import.meta.url)).text();

const indexHtml = await Bun.file(new URL("../../index.html", import.meta.url)).text();

const appSourceFiles: string[] = [];

for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan(import.meta.dir)) {
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) {
    continue;
  }

  appSourceFiles.push(await Bun.file(`${import.meta.dir}/${path}`).text());
}

const appSources = appSourceFiles.join("\n");

describe("site design contract", () => {
  test("uses shared interaction easing and avoids broad transitions", () => {
    expect(styles).toContain("--ease-out: cubic-bezier(0.23, 1, 0.32, 1)");
    expect(styles).toContain("--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)");
    expect(styles).not.toContain("transition: all");
    expect(styles).not.toContain("scale(0)");
  });

  test("keeps pointer feedback subtle and accessibility-aware", () => {
    expect(styles).toContain("@media (hover: hover) and (pointer: fine)");
    expect(styles).toContain("transform: scale(0.97)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(styles).toContain("@media (prefers-contrast: more)");
  });

  test("keeps every page inside the same root site bounds", () => {
    expect(styles).toContain(".site-header-shell");
    expect(styles).toContain(".home-shell");
    expect(styles).toContain(".content-shell");
    expect(styles).toContain(".legal-shell");
    expect(styles).toContain("width: min(920px, calc(100% - 40px))");
    expect(styles).toContain("grid-template-columns: 144px minmax(0, 1fr)");
    expect(styles).toContain("gap: 36px");
    expect(styles).toContain(".route-stage");
    expect(styles).toContain("animation: route-fade-out 75ms var(--ease-out) both");
    expect(styles).toContain("animation: route-fade-in 75ms var(--ease-out) both");
    expect(styles).toContain("@keyframes route-fade-out");
    expect(styles).toContain("@keyframes route-fade-in");
    expect(styles).toContain(".section-rail");
    expect(styles).toContain("top: 102px");
  });

  test("uses a stable sliding top-navigation indicator", () => {
    expect(styles).toContain("--site-nav-docs-width: 48px");
    expect(styles).toContain("--site-nav-changelog-width: 76px");
    expect(styles).toContain("--site-nav-github-width: 58px");
    expect(styles).toContain(".site-nav-indicator");
    expect(styles).toContain('site-nav[data-active="docs"]');
    expect(styles).toContain('site-nav[data-active="changelog"]');
    expect(styles).toContain("transform 180ms var(--ease-out)");
    expect(styles).toContain("font-weight: 620");
    expect(styles).not.toContain('a[aria-current="page"] {\n  background: var(--surface)');
    expect(styles).toContain("scrollbar-gutter: stable");
  });

  test("uses semantic color tokens for light and dark themes", () => {
    expect(styles).toContain("--text-primary: #171717");
    expect(styles).toContain("--background-primary: #fbfbfa");
    expect(styles).toContain("--text-success: #2f6f44");
    expect(styles).toContain('--comparison-control: #efefe8');
    expect(styles).toContain('--comparison-control-muted: #b8b8b0');
    expect(styles).toContain('html[data-theme="dark"]');
    expect(styles).toContain("--text-primary: #f4f4f0");
    expect(styles).toContain("--background-primary: #11110f");
    expect(styles).toContain("--text-success: #79c88f");
    expect(styles).toContain("color: var(--text-primary)");
    expect(styles).toContain("background: var(--background-primary)");
    expect(styles).not.toContain("var(--ink)");
    expect(styles).not.toContain("var(--canvas)");
    expect(styles).not.toContain("var(--surface)");
    expect(styles).not.toContain("var(--line)");
  });

  test("keeps raw color values inside the CSS theme layer", () => {
    expect(appSources).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\s*\(/iu);
    expect(themeSource).toContain('.getPropertyValue("--background-primary")');
    expect(themeSource).not.toContain("LIGHT_THEME_COLOR");
    expect(themeSource).not.toContain("DARK_THEME_COLOR");
    expect(indexHtml).toContain('<meta name="theme-color" content="" />');
    expect(indexHtml).not.toMatch(/theme-color" content="#[0-9a-f]{3,8}/iu);
    expect(indexHtml).not.toContain('storedTheme === "dark" ?');
  });

  test("keeps the reference title permanently in the left reading rail", () => {
    expect(styles).toContain(".site-header-shell-sticky");
    expect(styles).toContain("position: sticky");
    expect(styles).toContain("background: var(--background-header)");
    expect(styles).toContain(".section-rail-page-title");
    expect(styles).toContain("font-size: 18px");
    expect(styles).toContain("font-weight: 760");
    expect(styles).toContain("letter-spacing: -0.05em");
    expect(styles).not.toContain(".reference-page-title");
    expect(styles).not.toContain(".reference-page-header");
    expect(styles).not.toContain("reference-title-fade");
    expect(styles).not.toContain(".reference-title-motion");
    expect(styles).not.toContain("view-transition-name: reference-page-title");
    expect(styles).not.toContain("::view-transition-group(reference-page-title)");
    expect(styles).not.toContain(".site-page-context");
    expect(styles).toContain("top: 110px");
    expect(styles).toContain("scroll-margin-top: 164px");
  });

  test("shares one reference-page layout across docs and changelog", () => {
    expect(styles).toContain(".reference-section");
    expect(styles).toContain("padding: 34px 0 38px");
    expect(styles).toContain(".reference-page > .reference-section:first-of-type");
    expect(styles).toContain("padding-top: 24px");
    expect(styles).toContain("grid-template-columns: 144px minmax(0, 1fr)");
    expect(styles).toContain(".section-rail-group");
    expect(styles).toContain('.section-rail a[aria-current="location"]');
    expect(styles).toContain(".section-rail-label");
    expect(styles).toContain("max-height: calc(100vh - 118px)");
    expect(styles).not.toContain(".docs-page-header");
    expect(styles).not.toContain(".changelog-header");
    expect(styles).not.toContain(".changelog-page {\n  max-width");
    expect(styles).toContain(".spec-table");
  });

  test("styles footer and legal pages outside the top navigation", () => {
    expect(styles).toContain(".site-footer");
    expect(styles).toContain(".site-footer-links");
    expect(styles).toContain(".legal-page");
    expect(styles).toContain(".reference-page");
    expect(styles).toContain(".changelog-release");
  });
});
