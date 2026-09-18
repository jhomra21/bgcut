import { readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const CLOUDFLARE_ASSET_LIMIT_BYTES = 25 * 1024 * 1024;

const distDirectory = resolve(import.meta.dir, "../dist");

const walkFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
};

const isOrtRuntimeAsset = (name: string): boolean =>
  name.includes("ort-wasm-") &&
  (name.endsWith(".wasm") || name.endsWith(".mjs"));

const initialFiles = await walkFiles(distDirectory);

for (const path of initialFiles) {
  const name = relative(distDirectory, path);

  if (isOrtRuntimeAsset(name)) {
    await rm(path);
    console.log(`Removed R2-backed ORT runtime asset ${name} from Cloudflare Static Assets.`);
  }
}

const deployFiles = await walkFiles(distDirectory);

const oversized: string[] = [];

for (const path of deployFiles) {
  const file = await stat(path);

  if (file.size > CLOUDFLARE_ASSET_LIMIT_BYTES) {
    oversized.push(`${relative(distDirectory, path)} (${file.size} bytes)`);
  }
}

if (oversized.length > 0) {
  throw new Error(
    `Cloudflare static assets must be at most ${CLOUDFLARE_ASSET_LIMIT_BYTES} bytes. Oversized files: ${oversized.join(", ")}`,
  );
}

if (deployFiles.some((path) => relative(distDirectory, path).startsWith("models/"))) {
  throw new Error("Cloudflare builds must serve the model from R2, not Workers Static Assets.");
}

const leakedOrtRuntime = deployFiles
  .map((path) => relative(distDirectory, path))
  .filter(isOrtRuntimeAsset);

if (leakedOrtRuntime.length > 0) {
  throw new Error(
    `Cloudflare builds must serve ONNX Runtime assets from R2. Leaked files: ${leakedOrtRuntime.join(", ")}`,
  );
}

console.log(`Cloudflare app asset check passed for ${deployFiles.length} files.`);
