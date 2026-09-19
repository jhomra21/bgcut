import { describe, expect, test } from "bun:test";

import { logitToAlphaByte } from "./matte";

describe("logitToAlphaByte", () => {
  test("maps the decision boundary to half opacity", () => {
    expect(logitToAlphaByte(0)).toBe(128);
  });

  test("saturates strong foreground and background logits", () => {
    expect(logitToAlphaByte(20)).toBe(255);
    expect(logitToAlphaByte(-20)).toBe(0);
  });
});
