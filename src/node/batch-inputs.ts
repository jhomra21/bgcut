import { Either, Schema } from "effect";
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

const DIRECTORY_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const decodePathInput = (
  input: BgcutManyInput,
): string | undefined => {
  const decoded = Schema.decodeUnknownEither(Schema.String)(input);

  return Either.isRight(decoded) ? decoded.right : undefined;
};

const isDirectoryImage = (path: string): boolean =>
  DIRECTORY_IMAGE_EXTENSIONS.has(extname(path).toLowerCase());

const readDirectoryEntries = async (path: string) => {
  const entries = await readdir(path, { withFileTypes: true });

  return entries.sort((left, right) => left.name.localeCompare(right.name));
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

async function* expandOne(
  input: BgcutInput,
  recursive: boolean,
): AsyncGenerator<BgcutInputSource> {
  const inputPath = decodePathInput(input);

  if (inputPath === undefined) {
    yield { input };

    return;
  }

  const path = resolve(inputPath);

  try {
    const inputStat = await stat(path);

    if (inputStat.isDirectory()) {
      yield* walkDirectory(path, path, recursive);

      return;
    }
  } catch {
    // removeBackground() reports the ordinary input error for missing files.
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
  const pathInput = decodePathInput(inputs);

  if (pathInput !== undefined) {
    yield* expandOne(pathInput, recursive);

    return;
  }

  if (inputs instanceof Uint8Array || inputs instanceof ArrayBuffer) {
    yield* expandOne(inputs, recursive);

    return;
  }

  for await (const input of inputs) {
    yield* expandOne(input, recursive);
  }
}
