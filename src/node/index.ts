import { Effect, Either } from "effect";

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

export type BgcutSessionOptions = {
  readonly engine?: BgcutEngine;
};

export type BgcutSession = {
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
  readonly session?: undefined;
};

type SessionRemoveOptions = {
  readonly format?: BgcutFormat;
  readonly engine?: never;
  readonly session: BgcutSession;
};

export type RemoveBackgroundOptions =
  | OneShotRemoveOptions
  | SessionRemoveOptions;

export type RemoveBackgroundResult = BgcutRemovalResult;

type SessionState = {
  readonly native: NativeBgcut;
  closed: boolean;
};

const sessionStates = new WeakMap<BgcutSession, SessionState>();

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

const getOpenSessionState = (session: BgcutSession): SessionState => {
  const state = sessionStates.get(session);

  if (state === undefined) {
    throw new BgcutError(
      "engine",
      "The supplied bgcut session was not created by createSession().",
    );
  }

  if (state.closed) {
    throw new BgcutError("closed", "This bgcut session has already been closed.");
  }

  return state;
};

export const createSession = async (
  options: BgcutSessionOptions = {},
): Promise<BgcutSession> => {
  const native = await runPublicEffect(
    createNativeBgcut(options.engine ?? "auto").pipe(
      Effect.mapError(mapCreateError),
    ),
  );

  const session: BgcutSession = {
    engine: native.engine,
    fallbackReason: native.fallbackReason,
    setupTimings: native.setupTimings,
    close: async () => {
      const state = sessionStates.get(session);

      if (state === undefined || state.closed) {
        return;
      }

      state.closed = true;
      await Effect.runPromise(state.native.close());
    },
  };

  sessionStates.set(session, {
    native,
    closed: false,
  });

  return session;
};

const removeWithSession = (
  session: BgcutSession,
  input: BgcutInput,
  format: BgcutFormat,
): Promise<BgcutRemovalResult> => {
  const state = getOpenSessionState(session);

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

  if (options.session !== undefined) {
    return removeWithSession(options.session, input, format);
  }

  const session = await createSession({ engine: options.engine });

  try {
    return await removeWithSession(session, input, format);
  } finally {
    await session.close();
  }
};
