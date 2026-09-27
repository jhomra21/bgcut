import { Effect, Either, Schema } from "effect";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

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
  readonly removeMany: (
    inputs: BgcutBatchInput,
    options?: BgcutBatchRemoveOptions,
  ) => AsyncIterable<BgcutBatchResult>;
  readonly close: () => Promise<void>;
};

const DIRECTORY_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

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

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const decodePathInput = (input: unknown): string | undefined => {
  const decoded = Schema.decodeUnknownEither(Schema.String)(input);

  return Either.isRight(decoded) ? decoded.right : undefined;
};

const isDirectoryImage = (path: string): boolean =>
  DIRECTORY_IMAGE_EXTENSIONS.has(extname(path).toLowerCase());

const readDirectoryEntries = async (path: string) => {
  try {
    const entries = await readdir(path, { withFileTypes: true });

    return entries.toSorted((left, right) => left.name.localeCompare(right.name));
  } catch (cause) {
    throw new BgcutError(
      "input",
      `Could not read image directory ${path}.`,
      asError(cause),
    );
  }
};

async function* walkDirectory(
  rootPath: string,
  currentPath: string,
  recursive: boolean,
): AsyncGenerator<BgcutBatchSource> {
  for (const entry of await readDirectoryEntries(currentPath)) {
    const path = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        yield* walkDirectory(rootPath, path, recursive);
      }

      continue;
    }

    if (!entry.isFile() || !isDirectoryImage(path)) {
      continue;
    }

    yield {
      input: path,
      rootPath,
      relativePath: relative(rootPath, path),
    };
  }
}

async function* expandSingleInput(
  input: BgcutInput,
  recursive: boolean,
): AsyncGenerator<BgcutBatchSource> {
  const inputPath = decodePathInput(input);

  if (inputPath === undefined) {
    yield { input };

    return;
  }

  const path = resolve(inputPath);
  let inputStat;

  try {
    inputStat = await stat(path);
  } catch (cause) {
    throw new BgcutError(
      "input",
      `Could not inspect input path ${inputPath}.`,
      asError(cause),
    );
  }

  if (inputStat.isDirectory()) {
    yield* walkDirectory(path, path, recursive);

    return;
  }

  if (!inputStat.isFile()) {
    throw new BgcutError("input", `Input path is not a file or directory: ${inputPath}.`);
  }

  yield {
    input: path,
    relativePath: basename(path),
  };
}

async function* expandBatchInputs(
  inputs: BgcutBatchInput,
  recursive: boolean,
): AsyncGenerator<BgcutBatchSource> {
  const pathInput = decodePathInput(inputs);

  if (
    pathInput !== undefined ||
    inputs instanceof Uint8Array ||
    inputs instanceof ArrayBuffer
  ) {
    yield* expandSingleInput(
      pathInput ?? inputs as Uint8Array | ArrayBuffer,
      recursive,
    );

    return;
  }

  for await (const input of inputs) {
    yield* expandSingleInput(input, recursive);
  }
}

export const createBgcut = async (
  options: BgcutOptions = {},
): Promise<Bgcut> => {
  const native = await runPublicEffect(
    createNativeBgcut(options.engine ?? "auto").pipe(
      Effect.mapError(mapCreateError),
    ),
  );

  let closed = false;

  const remove = (
    input: BgcutInput,
    removeOptions: BgcutRemoveOptions = {},
  ): Promise<BgcutRemovalResult> => {
    if (closed) {
      return Promise.reject(
        new BgcutError("closed", "This bgcut instance has already been closed."),
      );
    }

    return runPublicEffect(
      native.remove(input, removeOptions.format ?? "png").pipe(
        Effect.mapError(mapRemoveError),
      ),
    );
  };

  const removeMany = async function* (
    inputs: BgcutBatchInput,
    removeOptions: BgcutBatchRemoveOptions = {},
  ): AsyncGenerator<BgcutBatchResult> {
    if (closed) {
      throw new BgcutError("closed", "This bgcut instance has already been closed.");
    }

    for await (const source of expandBatchInputs(
      inputs,
      removeOptions.recursive ?? true,
    )) {
      try {
        const result = await remove(source.input, {
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
  };

  return {
    engine: native.engine,
    fallbackReason: native.fallbackReason,
    setupTimings: native.setupTimings,
    remove,
    removeMany,
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
    const result = await bgcut.remove(input, { format: options.format });

    return {
      data: result.data,
      width: result.width,
      height: result.height,
      format: result.format,
    };
  } finally {
    await bgcut.close();
  }
};

export async function* removeBackgrounds(
  inputs: BgcutBatchInput,
  options: RemoveBackgroundsOptions = {},
): AsyncGenerator<BgcutBatchResult> {
  const bgcut = await createBgcut({ engine: options.engine });

  try {
    yield* bgcut.removeMany(inputs, {
      format: options.format,
      recursive: options.recursive,
    });
  } finally {
    await bgcut.close();
  }
}
