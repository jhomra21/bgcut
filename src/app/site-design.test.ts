import { describe, expect, test } from "bun:test";

const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text();

const themeSource = await Bun.file(new URL("./theme.ts", import.meta.url)).text();

const indexHtml = await Bun.file(new URL("../../index.html", import.meta.url)).text();

const staticHeaders = await Bun.file(new URL("../../public/_headers", import.meta.url)).text();

const themeBootstrap = await Bun.file(
  new URL("../../public/theme-bootstrap.js", import.meta.url),
).text();

const mainSource = await Bun.file(new URL("./main.tsx", import.meta.url)).text();

const staticRouteSource = await Bun.file(
  new URL("../../scripts/site/prepare-static-routes.ts", import.meta.url),
).text();

const serverEntrySource = await Bun.file(
  new URL("./server-entry.ts", import.meta.url),
).text();

const packageSource = await Bun.file(
  new URL("../../package.json", import.meta.url),
).text();

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

  test("uses the current Solid 2 RC hydration stack", () => {
    expect(packageSource).toContain('"solid-js": "2.0.0-rc.11"');
    expect(packageSource).toContain('"@solidjs/web": "2.0.0-rc.11"');
    expect(packageSource).toContain('"@solidjs/vite-plugin": "3.0.0-next.46"');
    expect(serverEntrySource).toContain("HydrationScript");
    expect(serverEntrySource).toContain("renderToString");
    expect(serverEntrySource).not.toContain("generateHydrationScript");
    expect(staticRouteSource).not.toContain("solid-hydration.js");
  });

  test("keeps the transparency checker on an element Match branch", () => {
    expect(appSources).toContain('<Match when={props.page === "tool-transparency-checker"}>');
    expect(appSources).toContain("<TransparencyCheckerPage />");
    expect(appSources).not.toContain("<Match keyed when={toolPage()}>");
    expect(appSources).not.toContain("{() => <TransparencyCheckerPage />}");
  });

  test("hydrates prerendered hosted routes instead of replacing them", () => {
    expect(mainSource).toContain('import { hydrate, render } from "@solidjs/web"');
    expect(mainSource).toContain("root.dataset.bgcutHydrate");
    expect(mainSource).toContain("hydrate(() => <App />, root");
    expect(mainSource).toContain("render(() => <App />, root)");
    expect(mainSource).not.toContain("root.replaceChildren()");
    expect(serverEntrySource).toContain("renderToString");
    expect(staticRouteSource).toContain('data-bgcut-hydrate');
    expect(serverEntrySource).toContain("HydrationScript");
    expect(serverEntrySource).toContain("renderHydrationScript");
    expect(staticRouteSource).toContain('import { Script } from "node:vm"');
    expect(staticRouteSource).toContain("addHydrationCspHash");
    expect(staticRouteSource).toContain('new Script(hydrationSource, { filename: "Solid HydrationScript" })');
    expect(staticRouteSource).not.toContain("solid-hydration.js");
    expect(serverEntrySource).not.toContain("generateHydrationScript");
    expect(staticRouteSource).toContain("buildServerRenderer");
    expect(staticRouteSource).not.toContain("staticHome");
    expect(staticRouteSource).not.toContain("staticGuide");
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

  test("restores a saved theme without violating the hosted CSP", () => {
    expect(indexHtml).toContain('<script src="/theme-bootstrap.js"></script>');
    expect(indexHtml).not.toContain('window.localStorage.getItem("bgcut-theme")');
    expect(themeBootstrap).toContain('window.localStorage.getItem("bgcut-theme")');
    expect(themeBootstrap).toContain("document.documentElement.dataset.theme = storedTheme");
    expect(themeSource).toContain("storedTheme()");
    expect(themeSource).toContain("document.documentElement.dataset.theme = initialTheme");
    expect(staticHeaders).toContain("script-src 'self' https://static.cloudflareinsights.com 'wasm-unsafe-eval'");
    expect(staticHeaders).not.toContain("script-src 'unsafe-inline'");
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

  test("keeps the hosted header as two floating sticky islands", () => {
    expect(styles).toContain(".site-header-shell-floating");
    expect(styles).toContain("position: sticky");
    expect(styles).toContain("pointer-events: none");
    expect(styles).toContain(".site-header-shell-floating::before");
    expect(styles).toContain("--header-fade-height: 28px");
    expect(styles).toContain("-webkit-backdrop-filter: blur(2px)");
    expect(styles).toContain("backdrop-filter: blur(2px)");
    expect(styles).toContain("-webkit-mask-image: linear-gradient(");
    expect(styles).toContain("mask-image: linear-gradient(");
    expect(styles).toContain("--header-fade-height: 16px");
    expect(styles).toContain(".site-header-shell-floating .brand-link");
    expect(styles).not.toContain(".site-header-brand {");
    expect(styles).toContain("background: var(--background-primary)");
    expect(styles).not.toContain("0 8px 24px var(--shadow-floating)");
    expect(styles).not.toContain(".site-header-shell-sticky::before");
    expect(styles).not.toContain("width: 100vw;\n  background: var(--background-header)");
    expect(styles).toContain(".site-nav");
    expect(styles).toContain(".theme-toggle");
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
    expect(styles).toContain(".section-rail a[aria-current]");
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
