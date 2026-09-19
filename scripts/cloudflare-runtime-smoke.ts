import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WASM_MODULE_PUBLIC_PATH,
  ORT_WASM_PUBLIC_PATH,
  ORT_WEBGPU_WASM_FILENAME,
  ORT_WEBGPU_WASM_PUBLIC_PATH,
} from "../src/shared/ort-runtime";

const WRANGLER_VERSION = "4.133.0";

const PORT = 8790;

const ORIGIN = `http://127.0.0.1:${PORT}`;

const repositoryRoot = resolve(import.meta.dir, "..");

const smokeState = resolve(repositoryRoot, ".wrangler/smoke-state");

const runtimeDirectory = resolve(
  repositoryRoot,
  "node_modules/onnxruntime-web/dist",
);

const run = async (command: string[]): Promise<void> => {
  const process = Bun.spawn(command, {
    cwd: repositoryRoot,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`);
  }
};

const seedRuntime = async (filename: string, contentType: string): Promise<void> =>
  run([
    "bunx",
    `wrangler@${WRANGLER_VERSION}`,
    "r2",
    "object",
    "put",
    `bgcut-models/${filename}`,
    "--file",
    resolve(runtimeDirectory, filename),
    "--content-type",
    contentType,
    "--cache-control",
    "public, max-age=31536000, immutable",
    "--local",
    "--persist-to",
    smokeState,
  ]);

const waitForWorker = async (): Promise<void> => {
  let lastError = new Error("Worker has not responded yet.");

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(ORIGIN);

      if (response.ok) {
        return;
      }

      lastError = new Error(`Worker returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await Bun.sleep(250);
  }

  throw new Error("Wrangler did not become ready for the runtime smoke test.", {
    cause: lastError,
  });
};

const verifyWasmResponse = async (label: string, publicPath: string): Promise<void> => {
  const response = await fetch(`${ORIGIN}${publicPath}`);

  if (!response.ok) {
    throw new Error(`${label} runtime route returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type");

  if (contentType === null || !contentType.startsWith("application/wasm")) {
    throw new Error(
      `${label} runtime route returned ${contentType ?? "no content type"} instead of application/wasm.`,
    );
  }

  if (response.body === null) {
    throw new Error(`${label} runtime route returned an empty response body.`);
  }

  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  await reader.cancel();

  const bytes = firstChunk.value;

  if (
    bytes === undefined ||
    bytes.length < 4 ||
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    throw new Error(`${label} runtime route did not return a WebAssembly binary.`);
  }
};

const verifyModuleResponse = async (): Promise<void> => {
  const response = await fetch(`${ORIGIN}${ORT_WASM_MODULE_PUBLIC_PATH}`);

  if (!response.ok) {
    throw new Error(`ORT module route returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type");

  if (contentType === null || !contentType.startsWith("text/javascript")) {
    throw new Error(
      `ORT module route returned ${contentType ?? "no content type"} instead of JavaScript.`,
    );
  }

  const source = await response.text();

  if (source.length === 0 || source.trimStart().startsWith("<!")) {
    throw new Error("ORT module route returned an empty response or SPA HTML.");
  }
};

await rm(smokeState, { recursive: true, force: true });

try {
  await seedRuntime(ORT_WEBGPU_WASM_FILENAME, "application/wasm");
  await seedRuntime(ORT_WASM_FILENAME, "application/wasm");
  await seedRuntime(ORT_WASM_MODULE_FILENAME, "text/javascript");
  await run(["bun", "run", "build:cloudflare"]);

  const worker = Bun.spawn(
    [
      "bunx",
      `wrangler@${WRANGLER_VERSION}`,
      "dev",
      "--persist-to",
      smokeState,
      "--port",
      String(PORT),
    ],
    {
      cwd: repositoryRoot,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  try {
    await waitForWorker();
    await verifyWasmResponse("WebGPU", ORT_WEBGPU_WASM_PUBLIC_PATH);
    await verifyWasmResponse("WebAssembly", ORT_WASM_PUBLIC_PATH);
    await verifyModuleResponse();
    console.log("Cloudflare R2 runtime smoke passed.");
  } finally {
    worker.kill();
    await worker.exited;
  }
} finally {
  await rm(smokeState, { recursive: true, force: true });
}
