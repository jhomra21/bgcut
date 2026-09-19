export type BrowserEnginePreference = "auto" | "webgpu" | "wasm";

export const resolveBrowserEnginePreference = (search: string): BrowserEnginePreference => {
  const engine = new URLSearchParams(search).get("engine");

  if (engine === "webgpu" || engine === "wasm") {
    return engine;
  }

  return "auto";
};
