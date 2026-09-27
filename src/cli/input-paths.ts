import { Data } from "effect";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

export type CliInputSource = {
  readonly inputPath: string;
  readonly rootPath: string | undefined;
  readonly relativePath: string;
};

export class CliInputPathError extends Data.TaggedError("CliInputPathError")<{
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
    throw new CliInputPathError({
      message: `Could not read image directory ${path}.`,
      cause,
    });
  }
};

async function* walkDirectory(
  rootPath: string,
  currentPath: string,
): AsyncGenerator<CliInputSource> {
  for (const entry of await readDirectoryEntries(currentPath)) {
    const path = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      yield* walkDirectory(rootPath, path);
      continue;
    }

    if (!entry.isFile() || !isDirectoryImage(path)) {
      continue;
    }

    yield {
      inputPath: path,
      rootPath,
      relativePath: relative(rootPath, path),
    };
  }
}

const inspectInputPath = async (inputPath: string) => {
  const path = resolve(inputPath);

  try {
    return {
      path,
      file: await stat(path),
    };
  } catch (cause) {
    throw new CliInputPathError({
      message: `Could not inspect input path ${inputPath}.`,
      cause,
    });
  }
};

export const isCliBatchInput = async (
  inputPaths: readonly string[],
): Promise<boolean> => {
  if (inputPaths.length > 1) {
    return true;
  }

  const inputPath = inputPaths.at(0);

  if (inputPath === undefined) {
    return false;
  }

  try {
    return (await stat(inputPath)).isDirectory();
  } catch {
    return false;
  }
};

export async function* expandCliInputPaths(
  inputPaths: readonly string[],
): AsyncGenerator<CliInputSource> {
  for (const inputPath of inputPaths) {
    const inspected = await inspectInputPath(inputPath);

    if (inspected.file.isDirectory()) {
      yield* walkDirectory(inspected.path, inspected.path);
      continue;
    }

    if (!inspected.file.isFile()) {
      throw new CliInputPathError({
        message: `Input path is not a file or directory: ${inputPath}.`,
      });
    }

    yield {
      inputPath: inspected.path,
      rootPath: undefined,
      relativePath: basename(inspected.path),
    };
  }
}
