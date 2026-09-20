import {
  ORT_WASM_MODULE_PUBLIC_PATH,
  ORT_WASM_PUBLIC_PATH,
  ORT_WEBGPU_WASM_PUBLIC_PATH,
} from "../shared/ort-assets";

export {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WASM_MODULE_PUBLIC_PATH,
  ORT_WASM_PUBLIC_PATH,
  ORT_WEBGPU_WASM_FILENAME,
  ORT_WEBGPU_WASM_PUBLIC_PATH,
} from "../shared/ort-assets";

export const resolveOrtWebGpuWasmUrl = (baseHref: string): string =>
  new URL(ORT_WEBGPU_WASM_PUBLIC_PATH, baseHref).href;

export const resolveOrtWasmUrl = (baseHref: string): string =>
  new URL(ORT_WASM_PUBLIC_PATH, baseHref).href;

export const resolveOrtWasmModuleUrl = (baseHref: string): string =>
  new URL(ORT_WASM_MODULE_PUBLIC_PATH, baseHref).href;
