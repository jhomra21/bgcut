import { Data } from "effect";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import type { BgcutInput } from "./runtime";

export type BgcutManyInput =
  | BgcutInput
  | Iterable<BgcutInput>
  | AsyncIterable<BgcutInput>;

export type BgcutInputSource = {
  readonly input: BgcutInput;
  readonly rootPath?: string;
  readonly relativePath?: string;
};

export class BgcutInputPathError extends Data.TaggedError("BgcutInputPathError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const DIRECTORY_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const isDirectoryImage = (path: string): boolean =>
  DIRECTORY_IMAGE_EXTENSIONS.has(extname(path).toLowerCase());

const readDirectoryEntries = async (path: string) => {
  try {
    const entries = await readdir(path, { withFileTypes: true });

    return entries.sort((left, right) => left.name.localeCompare(right.name));
  } catch (cause) {
    throw new BgcutInputPathError({
      message: `Could not read image directory ${path}.`,
      cause,
    });
  }
};

async function* walkDirectory(
  rootPath: string,
  currentPath: string,
  recursive: boolean,
): AsyncGenerator<BgcutInputSource> {
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

const isAtomicInput = (
  input: BgcutManyInput,
): input is BgcutInput =>
  typeof input === "string" ||
  input instanceof Uint8Array ||
  input instanceof ArrayBuffer;

async function* expandOne(
  input: BgcutInput,
  recursive: boolean,
): AsyncGenerator<BgcutInputSource> {
  if (typeof input !== "string") {
    yield { input };

    return;
  }

  const path = resolve(input);

  try {
    const inputStat = await stat(path);

    if (inputStat.isDirectory()) {
      yield* walkDirectory(path, path, recursive);

      return;
    }
  } catch {
    // Let removeBackground() report an ordinary input error for missing files.
  }

  yield {
    input: path,
    relativePath: basename(path),
  };
}

export async function* expandBgcutInputs(
  inputs: BgcutManyInput,
  recursive: boolean,
): AsyncGenerator<BgcutInputSource> {
  if (isAtomicInput(inputs)) {
    yield* expandOne(inputs, recursive);

    return;
  }

  for await (const input of inputs) {
    yield* expandOne(input, recursive);
  }
}
