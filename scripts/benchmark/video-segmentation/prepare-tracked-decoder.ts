import {
  mkdir,
} from "node:fs/promises";
import {
  dirname,
  resolve,
} from "node:path";

import {
  TRACKED_STEP_CACHE_PATH,
  TRACKED_STEP_METADATA_CACHE_PATH,
} from "../../../src/shared/video-experimental-config";

const prepare = async (
  script: string,
  outputPath: string,
  metadataPath: string,
  label: string,
) => {
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
          script,
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
      `${label} preparation exited with code ${exitCode}.`,
    );
  }

  await Bun.write(
    metadataPath,
    metadata,
  );

  console.log(
    `Prepared ${label} at ${outputPath}`,
  );
};

await prepare(
  "specialize-sam21-tracked-step.py",
  resolve(
    TRACKED_STEP_CACHE_PATH,
  ),
  resolve(
    TRACKED_STEP_METADATA_CACHE_PATH,
  ),
  "fused SAM tracked step",
);
