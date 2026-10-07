import {
  mkdir,
} from "node:fs/promises";
import {
  dirname,
  resolve,
} from "node:path";

import {
  TRACKED_MASK_DECODER_CACHE_PATH,
  TRACKED_MASK_DECODER_METADATA_CACHE_PATH,
} from "../../../src/shared/video-experimental-config";

const outputPath =
  resolve(
    TRACKED_MASK_DECODER_CACHE_PATH,
  );

const metadataPath =
  resolve(
    TRACKED_MASK_DECODER_METADATA_CACHE_PATH,
  );

await mkdir(
  dirname(
    outputPath,
  ),
  {
    recursive: true,
  },
);

const process =
  Bun.spawn(
    [
      "uv",
      "run",
      resolve(
        import.meta.dir,
        "specialize-sam21-tracked-decoder.py",
      ),
      outputPath,
    ],
    {
      stdout: "pipe",
      stderr: "inherit",
    },
  );

const metadata =
  await new Response(
    process.stdout,
  ).text();

const exitCode =
  await process.exited;

if (
  exitCode !==
  0
) {
  throw new Error(
    `Tracked SAM decoder preparation exited with code ${exitCode}.`,
  );
}

await Bun.write(
  metadataPath,
  metadata,
);

console.log(
  `Prepared tracked SAM decoder at ${outputPath}`,
);
