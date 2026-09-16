import { describe, expect, test } from "bun:test";

describe("gpu input module", () => {
  test("loads without resolving TypeGPU bind-group views eagerly", async () => {
    const gpuInput = await import("./gpu-input");

    expect(gpuInput.createGpuModelInput).toBeFunction();
    expect(gpuInput.releaseGpuModelInput).toBeFunction();
  });
});
