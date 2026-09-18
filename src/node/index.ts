import { Effect } from "effect";

import {
  createNativeBgcut,
  type BgcutEngine,
  type BgcutFormat,
  type BgcutInput,
  type BgcutRemovalResult,
} from "./runtime";

export type {
  BgcutEngine,
  BgcutExecutionEngine,
  BgcutFormat,
  BgcutInput,
  BgcutRemovalResult,
  BgcutRemovalTimings,
  BgcutSetupTimings,
} from "./runtime";

export type BgcutOptions = {
  readonly engine?: BgcutEngine;
};

export type BgcutRemoveOptions = {
  readonly format?: BgcutFormat;
};

export type Bgcut = {
  readonly engine: "webgpu" | "cpu";
  readonly fallbackReason: string | undefined;
  readonly setupTimings: {
    readonly modelMs: number;
    readonly sessionMs: number;
  };
  readonly remove: (
    input: BgcutInput,
    options?: BgcutRemoveOptions,
  ) => Promise<BgcutRemovalResult>;
  readonly close: () => Promise<void>;
};

export const createBgcut = async (
  options: BgcutOptions = {},
): Promise<Bgcut> => {
  const native = await Effect.runPromise(
    createNativeBgcut(options.engine ?? "auto"),
  );

  return {
    engine: native.engine,
    fallbackReason: native.fallbackReason,
    setupTimings: native.setupTimings,
    remove: (input, removeOptions = {}) =>
      Effect.runPromise(native.remove(input, removeOptions.format ?? "png")),
    close: () => Effect.runPromise(native.close()),
  };
};
