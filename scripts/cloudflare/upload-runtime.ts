import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WEBGPU_WASM_FILENAME,
} from "../../src/shared/ort-assets";

const WRANGLER_VERSION = "4.135.0";

const BUCKET = "bgcut-models";

const CACHE_CONTROL = "public,max-age=31536000,immutable";

const PRODUCTION_ORIGIN = "https://bgcut.dev";

const UPLOAD_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000] as const;

const repositoryRoot = resolve(import.meta.dir, "../..");

const runtimeDirectory = resolve(
  repositoryRoot,
  "node_modules/onnxruntime-web/dist",
);

type RuntimeAsset = {
  readonly filename: string;
  readonly contentType: string;
};

type RuntimeIntegrity = {
  readonly size: number;
  readonly md5: string;
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

const readIntegrity = async (source: string): Promise<RuntimeIntegrity> => {
  const file = Bun.file(source);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const md5 = createHash("md5").update(bytes).digest("hex");

  return {
    size: file.size,
    md5,
  };
};

const normalizeEtag = (etag: string): string =>
  etag
    .replace(/^W\//u, "")
    .replaceAll('"', "");

const remoteMatches = async (
  asset: RuntimeAsset,
  integrity: RuntimeIntegrity,
): Promise<boolean> => {
  const url = new URL(`/runtime/${asset.filename}`, PRODUCTION_ORIGIN);

  url.searchParams.set("integrity", integrity.md5);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "cache-control": "no-cache",
      },
    });

    if (!response.ok) {
      return false;
    }

    const contentLength = response.headers.get("content-length");
    const contentType = response.headers.get("content-type");
    const etag = response.headers.get("etag");

    return (
      contentLength === String(integrity.size) &&
      contentType !== null &&
      contentType.startsWith(asset.contentType) &&
      etag !== null &&
      normalizeEtag(etag) === integrity.md5
    );
  } catch {
    return false;
  }
};

const upload = async (
  asset: RuntimeAsset,
  source: string,
): Promise<number> => {
  const destination = `${BUCKET}/${asset.filename}`;

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
      cwd: repositoryRoot,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  return process.exited;
};

for (const asset of assets) {
  const source = resolve(runtimeDirectory, asset.filename);
  const integrity = await readIntegrity(source);

  if (await remoteMatches(asset, integrity)) {
    console.log(`Remote ${asset.filename} already matches; skipping upload.`);

    continue;
  }

  let uploaded = false;

  for (
    let attempt = 0;
    attempt <= UPLOAD_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    console.log(
      `Uploading ${asset.filename} to remote R2 (attempt ${attempt + 1}).`,
    );

    const exitCode = await upload(asset, source);

    if (exitCode === 0 || (await remoteMatches(asset, integrity))) {
      uploaded = true;

      break;
    }

    const delay = UPLOAD_RETRY_DELAYS_MS[attempt];

    if (delay !== undefined) {
      console.warn(
        `Remote upload failed for ${asset.filename}; retrying in ${delay}ms.`,
      );
      await Bun.sleep(delay);
    }
  }

  if (!uploaded) {
    throw new Error(
      `Failed to ensure ${asset.filename} is present in remote R2 after retries.`,
    );
  }
}

console.log("Remote ONNX Runtime assets are present and validated in bgcut-models.");
