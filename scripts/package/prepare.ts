import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

const run = async (args: readonly string[]): Promise<void> => {
  const process = Bun.spawn([...args], {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed with exit code ${exitCode}.`);
  }
};

const assertNodeRuntimeBuild = async (relativePath: string): Promise<void> => {
  const source = await readFile(resolve(root, relativePath), "utf8");

  if (/\bBun\./u.test(source)) {
    throw new Error(`${relativePath} still depends on a Bun runtime global.`);
  }
};

await Promise.all([
  rm(resolve(root, "dist/cli"), { recursive: true, force: true }),
  rm(resolve(root, "dist/node"), { recursive: true, force: true }),
  rm(resolve(root, "dist/web"), { recursive: true, force: true }),
]);

await run(["bun", "run", "brand:prepare"]);

await run(["bunx", "vite", "build", "--mode", "package"]);

await run(["bun", "run", "scripts/prepare-package-web.ts"]);

await run([
  "bun",
  "build",
  "src/cli/main.ts",
  "--target=node",
  "--format=esm",
  "--packages=external",
  "--outdir=dist/cli",
]);

await run([
  "bun",
  "build",
  "src/node/index.ts",
  "--target=node",
  "--format=esm",
  "--packages=external",
  "--outdir=dist/node",
]);

await Promise.all([
  assertNodeRuntimeBuild("dist/cli/main.js"),
  assertNodeRuntimeBuild("dist/node/index.js"),
]);

const modelFileSmokePath = resolve(root, "dist/.model-file-node-smoke.mjs");

await run([
  "bun",
  "build",
  "src/shared/model-file.ts",
  "--target=node",
  "--format=esm",
  "--packages=external",
  "--outfile=dist/.model-file-node-smoke.mjs",
]);

try {
  await run([
    "node",
    "--input-type=module",
    "-e",
    [
      'import { Effect } from "effect";',
      'import { inspectModelFile } from "./dist/.model-file-node-smoke.mjs";',
      'const fingerprint = await Effect.runPromise(inspectModelFile("package.json"));',
      'if (fingerprint === undefined || fingerprint.sizeBytes <= 0 || !/^[a-f0-9]{64}$/u.test(fingerprint.sha256)) process.exit(2);',
      'const missing = await Effect.runPromise(inspectModelFile("./dist/.definitely-missing-bgcut-model"));',
      'if (missing !== undefined) process.exit(3);',
    ].join(" "),
  ]);
} finally {
  await rm(modelFileSmokePath, { force: true });
}

console.log("Prepared npm CLI, local web app, and Node API.");
