import { describe, expect, test } from "bun:test";
import { chevronColor, chevronOpacity } from "./comparison-slider-state";

const sliderSource = await Bun.file(new URL("./ComparisonSlider.tsx", import.meta.url)).text();

describe("comparison slider handle", () => {
  test("dims the opposite chevron away from the center", () => {
    expect(chevronOpacity("left", 25)).toBe(1);
    expect(chevronOpacity("right", 25)).toBe(0.3);
    expect(chevronOpacity("left", 75)).toBe(0.3);
    expect(chevronOpacity("right", 75)).toBe(1);
    expect(chevronOpacity("left", 50)).toBe(1);
    expect(chevronOpacity("right", 50)).toBe(1);
    expect(chevronColor("left", 25)).toBe("#171717");
    expect(chevronColor("right", 25)).toBe("#a3a39c");
    expect(chevronColor("left", 50)).toBe("#171717");
  });

  test("uses separate chevrons with position-aware opacity", () => {
    expect(sliderSource).toContain("comparison-chevron-left");
    expect(sliderSource).toContain("comparison-chevron-right");
    expect(sliderSource).toContain("--comparison-left-opacity");
    expect(sliderSource).toContain("--comparison-right-opacity");
    expect(sliderSource).toContain("--comparison-left-color");
    expect(sliderSource).toContain("--comparison-right-color");
    expect(sliderSource).not.toContain("↔");
  });
});
