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

export type BgcutBatchInput =
  | BgcutInput
  | Iterable<BgcutInput>
  | AsyncIterable<BgcutInput>;

export type BgcutBatchRemoveOptions = BgcutRemoveOptions & {
  readonly recursive?: boolean;
};

export type RemoveBackgroundsOptions = RemoveBackgroundOptions & {
  readonly recursive?: boolean;
};

export type BgcutBatchSource = {
  readonly input: BgcutInput;
  readonly rootPath?: string;
  readonly relativePath?: string;
};

export type BgcutBatchResult =
  | {
      readonly ok: true;
      readonly source: BgcutBatchSource;
      readonly result: BgcutRemovalResult;
    }
  | {
      readonly ok: false;
      readonly source: BgcutBatchSource;
      readonly error: BgcutError;
    };

export type Bgcut = {
  readonly engine: BgcutExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly setupTimings: BgcutSetupTimings;
  readonly remove: (
    input: BgcutInput,
    options?: BgcutRemoveOptions,
  ) => Promise<BgcutRemovalResult>;
  readonly removeMany: (
    inputs: BgcutBatchInput,
    options?: BgcutBatchRemoveOptions,
  ) => AsyncIterable<BgcutBatchResult>;
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
 */
export declare const removeBackground: (
  input: BgcutInput,
  options?: RemoveBackgroundOptions,
) => Promise<RemoveBackgroundResult>;

/**
 * Process files, directories, or iterables sequentially with one reusable
 * runtime. Directory traversal is recursive by default.
 *
 * Results are yielded one at a time so callers do not have to retain an
 * entire batch in memory. Per-image failures are yielded with `ok: false`
 * and do not stop later images.
 */
export declare function removeBackgrounds(
  inputs: BgcutBatchInput,
  options?: RemoveBackgroundsOptions,
): AsyncIterable<BgcutBatchResult>;
