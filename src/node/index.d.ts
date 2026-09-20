export type BgcutEngine = "auto" | "gpu" | "cpu";

export type BgcutExecutionEngine = "webgpu" | "cpu";

export type BgcutFormat = "png" | "webp" | "jpg";

export type BgcutInput = string | Uint8Array | ArrayBuffer;

export type BgcutSetupTimings = {
  readonly modelMs: number;
  readonly sessionMs: number;
};

export type BgcutRemovalTimings = {
  readonly totalMs: number;
  readonly prepareMs: number;
  readonly inferenceMs: number;
  readonly encodeMs: number;
};

export type BgcutRemovalResult = {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly format: BgcutFormat;
  readonly engine: BgcutExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly timings: BgcutRemovalTimings;
};

export type BgcutErrorCode =
  | "model"
  | "engine"
  | "input"
  | "inference"
  | "output"
  | "closed";

/**
 * Stable public error returned by the Node API.
 *
 * Inspect `code` for programmatic handling. The original internal error is
 * available as `cause`.
 */
export declare class BgcutError extends Error {
  readonly code: BgcutErrorCode;
  constructor(code: BgcutErrorCode, message: string, cause?: Error);
}

export type BgcutOptions = {
  readonly engine?: BgcutEngine;
};

export type BgcutRemoveOptions = {
  readonly format?: BgcutFormat;
};

export type RemoveBackgroundOptions = {
  readonly engine?: BgcutEngine;
  readonly format?: BgcutFormat;
};

export type RemoveBackgroundResult = {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly format: BgcutFormat;
};

export type Bgcut = {
  readonly engine: BgcutExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly setupTimings: BgcutSetupTimings;
  readonly remove: (
    input: BgcutInput,
    options?: BgcutRemoveOptions,
  ) => Promise<BgcutRemovalResult>;
  readonly close: () => Promise<void>;
};

/**
 * Create a reusable bgcut instance.
 *
 * Reuse one instance when processing several images so the ONNX Runtime
 * session stays warm. Call `close()` when finished.
 */
export declare const createBgcut: (
  options?: BgcutOptions,
) => Promise<Bgcut>;

/**
 * Remove one image background and close the temporary runtime automatically.
 *
 * Use `createBgcut()` instead when processing several images.
 */
export declare const removeBackground: (
  input: BgcutInput,
  options?: RemoveBackgroundOptions,
) => Promise<RemoveBackgroundResult>;
