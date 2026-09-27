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

export declare class BgcutError extends Error {
  readonly code: BgcutErrorCode;
  constructor(code: BgcutErrorCode, message: string, cause?: Error);
}

export type BgcutOptions = {
  readonly engine?: BgcutEngine;
};

export type Bgcut = {
  readonly engine: BgcutExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly setupTimings: BgcutSetupTimings;
  readonly close: () => Promise<void>;
};

type OneShotRemoveOptions = {
  readonly format?: BgcutFormat;
  readonly engine?: BgcutEngine;
  readonly bgcut?: undefined;
};

type ReusableRemoveOptions = {
  readonly format?: BgcutFormat;
  readonly engine?: never;
  readonly bgcut: Bgcut;
};

export type RemoveBackgroundOptions =
  | OneShotRemoveOptions
  | ReusableRemoveOptions;

export type RemoveBackgroundResult = BgcutRemovalResult;

/**
 * Create a reusable bgcut instance.
 *
 * Pass the returned bgcut instance to removeBackground() when processing several
 * images. Call close() when finished.
 */
export declare const bgcut: (
  options?: BgcutOptions,
) => Promise<Bgcut>;

/**
 * Remove the background from one image.
 *
 * Without a bgcut instance, bgcut creates and closes a temporary runtime for this
 * call. Pass a bgcut instance to reuse one warm runtime across
 * several calls.
 */
export declare const removeBackground: (
  input: BgcutInput,
  options?: RemoveBackgroundOptions,
) => Promise<RemoveBackgroundResult>;
