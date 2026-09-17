import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ORT_WEBGPU_WASM_FILENAME,
  ORT_WEBGPU_WASM_PUBLIC_PATH,
} from "../src/engine/ort-webgpu-runtime";

const WRANGLER_VERSION = "4.133.0";
const PORT = 8790;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const repositoryRoot = resolve(import.meta.dir, "..");
const smokeState = resolve(repositoryRoot, ".wrangler/smoke-state");
const runtimeFile = resolve(
  repositoryRoot,
  "node_modules/onnxruntime-web/dist",
  ORT_WEBGPU_WASM_FILENAME,
);

const run = async (command: readonly string[]): Promise<void> => {
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

const waitForWorker = async (): Promise<void> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(ORIGIN);

      if (response.ok) {
        return;
      }

      lastError = new Error(`Worker returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await Bun.sleep(250);
  }

  throw new Error("Wrangler did not become ready for the runtime smoke test.", {
    cause: lastError,
  });
};

const verifyRuntimeResponse = async (): Promise<void> => {
  const response = await fetch(`${ORIGIN}${ORT_WEBGPU_WASM_PUBLIC_PATH}`);

  if (!response.ok) {
    throw new Error(`WebGPU runtime route returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type");

  if (contentType === null || !contentType.startsWith("application/wasm")) {
    throw new Error(
      `WebGPU runtime route returned ${contentType ?? "no content type"} instead of application/wasm.`,
    );
  }

  if (response.body === null) {
    throw new Error("WebGPU runtime route returned an empty response body.");
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
    throw new Error("WebGPU runtime route did not return a WebAssembly binary.");
  }
};

await rm(smokeState, { recursive: true, force: true });

try {
  await run([
    "bunx",
    `wrangler@${WRANGLER_VERSION}`,
    "r2",
    "object",
    "put",
    `bgcut-models/${ORT_WEBGPU_WASM_FILENAME}`,
    "--file",
    runtimeFile,
    "--content-type",
    "application/wasm",
    "--cache-control",
    "public, max-age=31536000, immutable",
    "--local",
    "--persist-to",
    smokeState,
  ]);

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
    await verifyRuntimeResponse();
    console.log("Cloudflare WebGPU runtime smoke passed.");
  } finally {
    worker.kill();
    await worker.exited;
  }
} finally {
  await rm(smokeState, { recursive: true, force: true });
}
