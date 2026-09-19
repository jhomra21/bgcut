import { resolve } from "node:path";

import {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WEBGPU_WASM_FILENAME,
} from "../src/shared/ort-runtime";

const WRANGLER_VERSION = "4.135.0";

const BUCKET = "bgcut-models";

const CACHE_CONTROL = "public,max-age=31536000,immutable";

const runtimeDirectory = resolve(
  import.meta.dir,
  "../node_modules/onnxruntime-web/dist",
);

type RuntimeAsset = {
  readonly filename: string;
  readonly contentType: string;
};

const assets: readonly RuntimeAsset[] = [
  {
    filename: ORT_WEBGPU_WASM_FILENAME,
    contentType: "application/wasm",
  },
  {
    filename: ORT_WASM_FILENAME,
    contentType: "application/wasm",
  },
  {
    filename: ORT_WASM_MODULE_FILENAME,
    contentType: "text/javascript",
  },
];

for (const asset of assets) {
  const source = resolve(runtimeDirectory, asset.filename);
  const destination = `${BUCKET}/${asset.filename}`;

  console.log(`Uploading ${asset.filename} to remote R2.`);

  const process = Bun.spawn(
    [
      "bunx",
      `wrangler@${WRANGLER_VERSION}`,
      "r2",
      "object",
      "put",
      destination,
      "--file",
      source,
      "--content-type",
      asset.contentType,
      `--cache-control=${CACHE_CONTROL}`,
      "--remote",
    ],
    {
      cwd: resolve(import.meta.dir, ".."),
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(
      `Failed to upload ${asset.filename} to remote R2 (exit ${exitCode}).`,
    );
  }
}

console.log("Remote ONNX Runtime assets are present in bgcut-models.");
