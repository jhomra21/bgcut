export const ORT_WEBGPU_WASM_FILENAME = "ort-wasm-simd-threaded.asyncify.wasm";

export const ORT_WASM_FILENAME = "ort-wasm-simd-threaded.wasm";

export const ORT_WASM_MODULE_FILENAME = "ort-wasm-simd-threaded.mjs";

export const ORT_WEBGPU_WASM_PUBLIC_PATH = `/runtime/${ORT_WEBGPU_WASM_FILENAME}`;

export const ORT_WASM_PUBLIC_PATH = `/runtime/${ORT_WASM_FILENAME}`;

export const ORT_WASM_MODULE_PUBLIC_PATH = `/runtime/${ORT_WASM_MODULE_FILENAME}`;

export const resolveOrtWebGpuWasmUrl = (baseHref: string): string =>
  new URL(ORT_WEBGPU_WASM_PUBLIC_PATH, baseHref).href;

export const resolveOrtWasmUrl = (baseHref: string): string =>
  new URL(ORT_WASM_PUBLIC_PATH, baseHref).href;

export const resolveOrtWasmModuleUrl = (baseHref: string): string =>
  new URL(ORT_WASM_MODULE_PUBLIC_PATH, baseHref).href;
