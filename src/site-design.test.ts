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
    expect(styles).toContain(".docs-sidebar");
    expect(styles).toContain("top: 24px");
  });

  test("animates top navigation state changes at 150ms", () => {
    expect(styles).toContain("background-color 150ms ease");
    expect(styles).toContain("color 150ms ease");
    expect(styles).toContain("box-shadow 150ms ease");
  });

  test("styles footer and legal pages outside the top navigation", () => {
    expect(styles).toContain(".site-footer");
    expect(styles).toContain(".site-footer-links");
    expect(styles).toContain(".legal-page");
  });
});
