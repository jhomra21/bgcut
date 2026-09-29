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

export type BgcutManyInput =
  | BgcutInput
  | Iterable<BgcutInput>
  | AsyncIterable<BgcutInput>;

export type BgcutInputSource = {
  readonly input: BgcutInput;
  readonly rootPath?: string;
  readonly relativePath?: string;
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

export type BgcutRemoveManyOptions = BgcutRemoveOptions & {
  readonly recursive?: boolean;
};

export type BgcutManyResult =
  | {
      readonly ok: true;
      readonly source: BgcutInputSource;
      readonly result: BgcutRemovalResult;
    }
  | {
      readonly ok: false;
      readonly source: BgcutInputSource;
      readonly error: BgcutError;
    };

export type Bgcut = {
  readonly engine: BgcutExecutionEngine;
  readonly fallbackReason: string | undefined;
  readonly setupTimings: BgcutSetupTimings;

  /**
   * Remove the background from one image with this bgcut instance.
   */
  readonly removeBackground: (
    input: BgcutInput,
    options?: BgcutRemoveOptions,
  ) => Promise<BgcutRemovalResult>;

  /**
   * Process files, directories, iterables, or async iterables sequentially.
   *
   * Directories are recursive by default. Results are yielded one at a time.
   * Per-image failures are yielded with ok: false and do not stop later inputs.
   */
  readonly removeMany: (
    inputs: BgcutManyInput,
    options?: BgcutRemoveManyOptions,
  ) => AsyncIterable<BgcutManyResult>;

  /**
   * Release the reusable native runtime.
   */
  readonly close: () => Promise<void>;
};

/**
 * Open a reusable bgcut instance.
 *
 * Call close() when finished.
 */
export declare const bgcut: (
  options?: BgcutOptions,
) => Promise<Bgcut>;
