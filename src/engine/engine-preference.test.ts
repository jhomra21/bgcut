import { describe, expect, test } from "bun:test";

import { resolveBrowserEnginePreference } from "./engine-preference";

describe("browser engine preference", () => {
  test("defaults to automatic selection", () => {
    expect(resolveBrowserEnginePreference("")).toBe("auto");
    expect(resolveBrowserEnginePreference("?engine=unknown")).toBe("auto");
  });

  test("accepts explicit WebGPU and WASM diagnostics", () => {
    expect(resolveBrowserEnginePreference("?engine=webgpu")).toBe("webgpu");
    expect(resolveBrowserEnginePreference("?engine=wasm")).toBe("wasm");
  });
});
