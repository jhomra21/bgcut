import { Effect } from "effect";

import { ModelCacheError } from "../native/model-cache";
import {
  BgcutImageError,
  BgcutInferenceError,
  BgcutOutputError,
  BgcutSessionError,
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

export type BgcutErrorCode =
  | "model"
  | "engine"
  | "input"
  | "inference"
  | "output"
  | "closed";

export class BgcutError extends Error {
  readonly code: BgcutErrorCode;

  constructor(code: BgcutErrorCode, message: string, cause?: Error) {
    super(message, { cause });
    this.name = "BgcutError";
    this.code = code;
  }
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

export type RemoveBackgroundResult = BgcutRemovalResult;

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

const mapCreateError = (
  error: ModelCacheError | BgcutSessionError,
): BgcutError => {
  if (error instanceof ModelCacheError) {
    return new BgcutError("model", error.message, error);
  }

  return new BgcutError("engine", error.message, error);
};

const mapRemoveError = (
  error: BgcutImageError | BgcutInferenceError | BgcutOutputError,
): BgcutError => {
  if (error instanceof BgcutImageError) {
    return new BgcutError("input", error.message, error);
  }

  if (error instanceof BgcutInferenceError) {
    return new BgcutError("inference", error.message, error);
  }

  return new BgcutError("output", error.message, error);
};

export const createBgcut = async (
  options: BgcutOptions = {},
): Promise<Bgcut> => {
  const native = await Effect.runPromise(
    createNativeBgcut(options.engine ?? "auto").pipe(
      Effect.mapError(mapCreateError),
    ),
  );

  let closed = false;

  return {
    engine: native.engine,
    fallbackReason: native.fallbackReason,
    setupTimings: native.setupTimings,
    remove: (input, removeOptions = {}) => {
      if (closed) {
        return Promise.reject(
          new BgcutError("closed", "This bgcut instance has already been closed."),
        );
      }

      return Effect.runPromise(
        native.remove(input, removeOptions.format ?? "png").pipe(
          Effect.mapError(mapRemoveError),
        ),
      );
    },
    close: async () => {
      if (closed) {
        return;
      }

      closed = true;
      await Effect.runPromise(native.close());
    },
  };
};

export const removeBackground = async (
  input: BgcutInput,
  options: RemoveBackgroundOptions = {},
): Promise<RemoveBackgroundResult> => {
  const bgcut = await createBgcut({ engine: options.engine });

  try {
    return await bgcut.remove(input, { format: options.format });
  } finally {
    await bgcut.close();
  }
};
