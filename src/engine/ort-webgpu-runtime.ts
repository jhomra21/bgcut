export const ORT_WEBGPU_WASM_FILENAME = "ort-wasm-simd-threaded.asyncify.wasm";

export const ORT_WEBGPU_WASM_PUBLIC_PATH = `/runtime/${ORT_WEBGPU_WASM_FILENAME}`;

export const resolveOrtWebGpuWasmUrl = (baseHref: string): string =>
  new URL(ORT_WEBGPU_WASM_PUBLIC_PATH, baseHref).href;
