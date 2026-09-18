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

export type BgcutOptions = {
  readonly engine?: BgcutEngine;
};

export type BgcutRemoveOptions = {
  readonly format?: BgcutFormat;
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

export declare const createBgcut: (
  options?: BgcutOptions,
) => Promise<Bgcut>;
