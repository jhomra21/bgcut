import { describe, expect, test } from "bun:test";

const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text();

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
    expect(styles).toContain("top: 82px");
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

  test("pins borderless reference chrome and keeps the page name in the rail", () => {
    expect(styles).toContain(".site-header-shell-sticky");
    expect(styles).toContain("position: sticky");
    expect(styles).toContain("background: rgba(251, 251, 250, 0.94)");
    expect(styles).not.toContain("site-header-shell-sticky[data-scrolled");
    expect(styles).toContain(".section-rail-page-title");
    expect(styles).toContain('.section-rail-page-title[data-visible="true"]');
    expect(styles).not.toContain(".site-page-context");
    expect(styles).toContain("top: 100px");
    expect(styles).toContain("scroll-margin-top: 154px");
  });

  test("shares one reference-page layout across docs and changelog", () => {
    expect(styles).toContain(".reference-page-header");
    expect(styles).toContain(".reference-page-header h1");
    expect(styles).toContain(".reference-section");
    expect(styles).toContain(".reference-page > .reference-section:first-of-type");
    expect(styles).toContain("font-size: clamp(38px, 6vw, 56px)");
    expect(styles).toContain("padding: 34px 0 38px");
    expect(styles).toContain("grid-template-columns: 144px minmax(0, 1fr)");
    expect(styles).toContain(".section-rail-group");
    expect(styles).toContain('.section-rail a[aria-current="location"]');
    expect(styles).toContain(".section-rail-label");
    expect(styles).toContain("max-height: calc(100vh - 98px)");
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
