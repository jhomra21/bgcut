import { Effect, Either } from "effect";

import { ModelCacheError } from "../native/model-cache";
import {
  BgcutImageError,
  BgcutInferenceError,
  BgcutOutputError,
  BgcutError,
  createNativeBgcut,
  type BgcutEngine,
  type BgcutFormat,
  type BgcutInput,
  type BgcutRemovalResult,
  type NativeBgcut,
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

export type Bgcut = {
  readonly engine: "webgpu" | "cpu";
  readonly fallbackReason: string | undefined;
  readonly setupTimings: {
    readonly modelMs: number;
    readonly sessionMs: number;
  };
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

type BgcutState = {
  readonly native: NativeBgcut;
  closed: boolean;
};

const bgcutStates = new WeakMap<Bgcut, BgcutState>();

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
  error: ModelCacheError | BgcutError,
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

const getOpenBgcutState = (bgcut: Bgcut): BgcutState => {
  const state = bgcutStates.get(session);

  if (state === undefined) {
    throw new BgcutError(
      "engine",
      "The supplied bgcut instance was not created by bgcut().",
    );
  }

  if (state.closed) {
    throw new BgcutError("closed", "This bgcut instance has already been closed.");
  }

  return state;
};

export const bgcut = async (
  options: BgcutOptions = {},
): Promise<Bgcut> => {
  const native = await runPublicEffect(
    createNativeBgcut(options.engine ?? "auto").pipe(
      Effect.mapError(mapCreateError),
    ),
  );

  const bgcut: Bgcut = {
    engine: native.engine,
    fallbackReason: native.fallbackReason,
    setupTimings: native.setupTimings,
    close: async () => {
      const state = bgcutStates.get(session);

      if (state === undefined || state.closed) {
        return;
      }

      state.closed = true;
      await Effect.runPromise(state.native.close());
    },
  };

  bgcutStates.set(session, {
    native,
    closed: false,
  });

  return instance;
};

const removeWithBgcut = (
  bgcut: Bgcut,
  input: BgcutInput,
  format: BgcutFormat,
): Promise<BgcutRemovalResult> => {
  const state = getOpenBgcutState(instance);

  return runPublicEffect(
    state.native.remove(input, format).pipe(
      Effect.mapError(mapRemoveError),
    ),
  );
};

export const removeBackground = async (
  input: BgcutInput,
  options: RemoveBackgroundOptions = {},
): Promise<RemoveBackgroundResult> => {
  const format = options.format ?? "png";

  if (options.bgcut !== undefined) {
    return removeWithBgcut(options.bgcut, input, format);
  }

  const instance = await bgcut({ engine: options.engine });

  try {
    return await removeWithBgcut(instance, input, format);
  } finally {
    await instance.close();
  }
};
