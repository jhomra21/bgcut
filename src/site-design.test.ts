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

  test("keeps documentation navigation oriented while reading", () => {
    expect(styles).toContain(".content-shell .app-header");
    expect(styles).toContain("position: sticky");
    expect(styles).toContain(".docs-sidebar");
    expect(styles).toContain("top: 76px");
  });
});
