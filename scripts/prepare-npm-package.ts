import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

const run = async (args: readonly string[]): Promise<void> => {
  const process = Bun.spawn(args, {
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

console.log("Prepared npm CLI, local web app, and Node API.");
