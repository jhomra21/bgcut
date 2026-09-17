import { describe, expect, test } from "bun:test";
import { chevronColor, chevronOpacity } from "./comparison-slider-state";

const sliderSource = await Bun.file(new URL("./ComparisonSlider.tsx", import.meta.url)).text();

describe("comparison slider handle", () => {
  test("dims the opposite chevron away from the center", () => {
    expect(chevronOpacity("left", "left")).toBe(1);
    expect(chevronOpacity("right", "left")).toBe(0.3);
    expect(chevronOpacity("left", "right")).toBe(0.3);
    expect(chevronOpacity("right", "right")).toBe(1);
    expect(chevronOpacity("left", undefined)).toBe(1);
    expect(chevronOpacity("right", undefined)).toBe(1);
    expect(chevronColor("left", "left")).toBe("#171717");
    expect(chevronColor("right", "left")).toBe("#a3a39c");
  });

  test("uses separate chevrons with position-aware opacity", () => {
    expect(sliderSource).toContain("comparison-chevron-left");
    expect(sliderSource).toContain("comparison-chevron-right");
    expect(sliderSource).toContain("--comparison-left-opacity");
    expect(sliderSource).toContain("--comparison-right-opacity");
    expect(sliderSource).toContain("--comparison-left-color");
    expect(sliderSource).toContain("--comparison-right-color");
    expect(sliderSource).toContain("onPointerMove");
    expect(sliderSource).toContain("onPointerUp");
    expect(sliderSource).toContain("aspectRatio");
    expect(sliderSource).toContain("const handleDeadZone = 12");
    expect(sliderSource).not.toContain("chevronHighlight");
    expect(sliderSource).not.toContain("↔");
  });
});
