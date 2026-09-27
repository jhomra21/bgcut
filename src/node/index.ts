import { Effect, Either } from "effect";

import { ModelCacheError } from "../native/model-cache";
import {
  BgcutInputPathError,
  expandBgcutInputs,
  type BgcutInputSource,
  type BgcutManyInput,
} from "./batch-inputs";
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

export type {
  BgcutInputSource,
  BgcutManyInput,
} from "./batch-inputs";

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
  readonly engine: "webgpu" | "cpu";
  readonly fallbackReason: string | undefined;
  readonly setupTimings: {
    readonly modelMs: number;
    readonly sessionMs: number;
  };
  readonly removeBackground: (
    input: BgcutInput,
    options?: BgcutRemoveOptions,
  ) => Promise<BgcutRemovalResult>;
  readonly removeMany: (
    inputs: BgcutManyInput,
    options?: BgcutRemoveManyOptions,
  ) => AsyncIterable<BgcutManyResult>;
  readonly close: () => Promise<void>;
};

const runPublicEffect = async <A, E extends Error>(
  effect: Effect.Effect<A, E>,
): Promise<A> => {
  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isLeft(result)) {
    throw result.left;
  }

  return result.right;
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

export const bgcut = async (
  options: BgcutOptions = {},
): Promise<Bgcut> => {
  const native = await runPublicEffect(
    createNativeBgcut(options.engine ?? "auto").pipe(
      Effect.mapError(mapCreateError),
    ),
  );

  let closed = false;

  const assertOpen = () => {
    if (closed) {
      throw new BgcutError("closed", "This bgcut instance has already been closed.");
    }
  };

  const removeBackground = (
    input: BgcutInput,
    removeOptions: BgcutRemoveOptions = {},
  ): Promise<BgcutRemovalResult> => {
    assertOpen();

    return runPublicEffect(
      native.remove(input, removeOptions.format ?? "png").pipe(
        Effect.mapError(mapRemoveError),
      ),
    );
  };

  const removeMany = async function* (
    inputs: BgcutManyInput,
    removeOptions: BgcutRemoveManyOptions = {},
  ): AsyncGenerator<BgcutManyResult> {
    assertOpen();

    let sawInput = false;

    try {
      for await (const source of expandBgcutInputs(
        inputs,
        removeOptions.recursive ?? true,
      )) {
        sawInput = true;

        try {
          const result = await removeBackground(source.input, {
            format: removeOptions.format,
          });

          yield {
            ok: true,
            source,
            result,
          };
        } catch (error) {
          if (!(error instanceof BgcutError)) {
            throw error;
          }

          if (error.code === "closed") {
            throw error;
          }

          yield {
            ok: false,
            source,
            error,
          };
        }
      }
    } catch (error) {
      if (error instanceof BgcutInputPathError) {
        throw new BgcutError("input", error.message, error);
      }

      throw error;
    }

    if (!sawInput) {
      throw new BgcutError(
        "input",
        "No supported JPEG, PNG, WebP, or AVIF images were found.",
      );
    }
  };

  const close = async () => {
    if (closed) {
      return;
    }

    closed = true;
    await Effect.runPromise(native.close());
  };

  return {
    engine: native.engine,
    fallbackReason: native.fallbackReason,
    setupTimings: native.setupTimings,
    removeBackground,
    removeMany,
    close,
  };
};
