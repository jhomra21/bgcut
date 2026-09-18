import { copyFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const distDirectory = resolve(import.meta.dir, "../dist/web");
const publicDirectory = resolve(import.meta.dir, "../public");

const SITE_ROOT_FILES = [
  "apple-touch-icon.png",
  "favicon-48x48.png",
  "icon-192x192.png",
  "icon-512x512.png",
  "og-image.png",
  "robots.txt",
  "site.webmanifest",
  "sitemap.xml",
] as const;

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

for (const name of SITE_ROOT_FILES) {
  await copyFile(join(publicDirectory, name), join(distDirectory, name));
}

const initialFiles = await walkFiles(distDirectory);

for (const path of initialFiles) {
  const name = relative(distDirectory, path);

  if (isOrtRuntimeAsset(name)) {
    await rm(path);
    console.log(`Removed locally-served ONNX Runtime asset ${name} from the packaged web app.`);
  }
}

const packagedFiles = await walkFiles(distDirectory);
const packagedNames = packagedFiles.map((path) => relative(distDirectory, path));

if (packagedNames.some((name) => name.startsWith("models/"))) {
  throw new Error("The npm web app must load the model from the shared bgcut cache, not ship it in the package.");
}

const leakedRuntime = packagedNames.filter(isOrtRuntimeAsset);

if (leakedRuntime.length > 0) {
  throw new Error(`The npm web app must serve ONNX Runtime from the installed dependency. Leaked files: ${leakedRuntime.join(", ")}`);
}

const missingSiteFiles = SITE_ROOT_FILES.filter((name) => !packagedNames.includes(name));

if (missingSiteFiles.length > 0) {
  throw new Error(`The npm web app is missing site assets: ${missingSiteFiles.join(", ")}`);
}

for (const path of packagedFiles) {
  const file = await stat(path);

  if (file.size > 25 * 1024 * 1024) {
    throw new Error(`Unexpected oversized npm web asset: ${relative(distDirectory, path)} (${file.size} bytes).`);
  }
}

console.log(`Packaged bgcut web app verified with ${packagedFiles.length} files.`);
