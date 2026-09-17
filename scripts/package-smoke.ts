import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (command: string, args: readonly string[], cwd: string): string => {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}.\n${result.stdout}${result.stderr}`,
    );
  }

  return result.stdout.trim();
};

const root = process.cwd();

const temporaryRoot = await mkdtemp(join(tmpdir(), "bgcut-package-smoke-"));

try {
  const packageDirectory = join(temporaryRoot, "package");
  const consumerDirectory = join(temporaryRoot, "consumer");

  await mkdir(packageDirectory);
  await mkdir(consumerDirectory);

  const packedName = run("npm", ["pack", "--pack-destination", packageDirectory], root)
    .split("\n")
    .at(-1);

  if (packedName === undefined || !packedName.endsWith(".tgz")) {
    throw new Error(`npm pack did not return a tarball name: ${packedName ?? "<empty>"}`);
  }

  const tarballPath = join(packageDirectory, packedName);

  await writeFile(join(consumerDirectory, "package.json"), '{"private":true}\n');
  run("npm", ["install", tarballPath], consumerDirectory);

  const binName = process.platform === "win32" ? "bgcut.cmd" : "bgcut";
  const binPath = join(consumerDirectory, "node_modules", ".bin", binName);
  const help = run(binPath, ["--help"], consumerDirectory);

  if (!help.includes("Usage:") || !help.includes("bgcut <image>")) {
    throw new Error(`Installed bgcut binary returned unexpected help output:\n${help}`);
  }

  const skillPath = join(consumerDirectory, "node_modules", "bgcut", "skills", "bgcut", "SKILL.md");
  const skill = await readFile(skillPath, "utf8");

  if (!skill.includes("name: bgcut") || !skill.includes("bunx bgcut@beta")) {
    throw new Error(`Installed bgcut agent skill is missing its expected contract: ${skillPath}`);
  }

  console.log(`npm tarball consumer smoke passed for ${packedName}, including the bundled bgcut agent skill.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
