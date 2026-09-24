import { resolve } from "node:path";

import {
  WEBGPU_MODEL_FILENAME,
  WEBGPU_MODEL_MD5,
  WEBGPU_MODEL_SIZE_BYTES,
} from "../../src/shared/model-config";

const WRANGLER_VERSION = "4.135.0";

const BUCKET = "bgcut-models";

const CACHE_CONTROL = "public,max-age=31536000,immutable";

const PRODUCTION_ORIGIN = "https://bgcut.dev";

const UPLOAD_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000] as const;

const repositoryRoot = resolve(import.meta.dir, "../..");

const source = resolve(
  repositoryRoot,
  "public/models",
  WEBGPU_MODEL_FILENAME,
);

const normalizeEtag = (etag: string): string =>
  etag
    .replace(/^W\//u, "")
    .replaceAll('"', "");

const remoteMatches = async (): Promise<boolean> => {
  const url = new URL(`/models/${WEBGPU_MODEL_FILENAME}`, PRODUCTION_ORIGIN);

  url.searchParams.set("integrity", WEBGPU_MODEL_MD5);

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
      contentLength === String(WEBGPU_MODEL_SIZE_BYTES) &&
      contentType !== null &&
      contentType.startsWith("application/octet-stream") &&
      etag !== null &&
      normalizeEtag(etag) === WEBGPU_MODEL_MD5
    );
  } catch {
    return false;
  }
};

const upload = async (): Promise<number> => {
  const destination = `${BUCKET}/${WEBGPU_MODEL_FILENAME}`;

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
      "application/octet-stream",
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

const file = Bun.file(source);

if (!(await file.exists()) || file.size !== WEBGPU_MODEL_SIZE_BYTES) {
  throw new Error(
    `Prepared WebGPU model is missing or has the wrong size at ${source}.`,
  );
}

if (await remoteMatches()) {
  console.log(`Remote ${WEBGPU_MODEL_FILENAME} already matches; skipping upload.`);
  process.exit(0);
}

let uploaded = false;

for (
  let attempt = 0;
  attempt <= UPLOAD_RETRY_DELAYS_MS.length;
  attempt += 1
) {
  console.log(
    `Uploading ${WEBGPU_MODEL_FILENAME} to remote R2 (attempt ${attempt + 1}).`,
  );

  const exitCode = await upload();

  if (exitCode === 0 || (await remoteMatches())) {
    uploaded = true;

    break;
  }

  const delay = UPLOAD_RETRY_DELAYS_MS[attempt];

  if (delay !== undefined) {
    console.warn(
      `Remote model upload failed; retrying in ${delay}ms.`,
    );
    await Bun.sleep(delay);
  }
}

if (!uploaded) {
  throw new Error(
    `Failed to ensure ${WEBGPU_MODEL_FILENAME} is present in remote R2 after retries.`,
  );
}

console.log(`Remote ${WEBGPU_MODEL_FILENAME} is present in bgcut-models.`);
