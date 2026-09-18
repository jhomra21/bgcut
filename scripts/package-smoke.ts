import { spawn, spawnSync } from "node:child_process";
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

const readFirstLine = async (
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<string> =>
  new Promise<string>((resolveLine, rejectLine) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      result();
    };

    const timeout = setTimeout(() => {
      finish(() => rejectLine(new Error(`Timed out waiting for bgcut local server. stderr:\n${stderr}`)));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");

      if (newline >= 0) {
        finish(() => resolveLine(stdout.slice(0, newline).trim()));
      }
    });

    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("exit", (code) => {
      finish(() =>
        rejectLine(
          new Error(
            `bgcut local server exited before startup with code ${code ?? "unknown"}. stderr:\n${stderr}`,
          ),
        )
      );
    });
  });

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

  await writeFile(join(consumerDirectory, "package.json"), '{"private":true,"type":"module"}\n');
  run("npm", ["install", tarballPath], consumerDirectory);

  const binName = process.platform === "win32" ? "bgcut.cmd" : "bgcut";
  const binPath = join(consumerDirectory, "node_modules", ".bin", binName);
  const help = run(binPath, ["--help"], consumerDirectory);

  if (
    !help.includes("bgcut serve") ||
    !help.includes("bgcut <image>") ||
    !help.includes("Open the local bgcut web app")
  ) {
    throw new Error(`Installed bgcut binary returned unexpected help output:\n${help}`);
  }

  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import('bgcut').then((module) => { if (typeof module.createBgcut !== 'function') process.exit(2) })",
    ],
    consumerDirectory,
  );

  const localApp = spawn(binPath, ["serve", "--json"], {
    cwd: consumerDirectory,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const startupLine = await readFirstLine(localApp, 15_000);
    const startup = JSON.parse(startupLine) as {
      readonly url?: string;
      readonly host?: string;
      readonly port?: number;
    };

    if (
      typeof startup.url !== "string" ||
      startup.host !== "127.0.0.1" ||
      typeof startup.port !== "number" ||
      startup.port <= 0
    ) {
      throw new Error(`Unexpected bgcut local-server startup payload: ${startupLine}`);
    }

    const page = await fetch(startup.url);

    if (!page.ok || !(await page.text()).includes("bgcut")) {
      throw new Error(`Packaged bgcut web app was not served from ${startup.url}.`);
    }

    const health = await fetch(new URL("/health", startup.url));
    const healthBody = await health.json() as { readonly ok?: boolean; readonly service?: string };

    if (!health.ok || healthBody.ok !== true || healthBody.service !== "bgcut-local") {
      throw new Error(`Packaged bgcut health route failed at ${startup.url}health.`);
    }
  } finally {
    localApp.kill("SIGTERM");
    await new Promise<void>((resolveExit) => {
      if (localApp.exitCode !== null) {
        resolveExit();
      } else {
        localApp.once("exit", () => resolveExit());
      }
    });
  }

  const skillPath = join(consumerDirectory, "node_modules", "bgcut", "skills", "bgcut", "SKILL.md");
  const skill = await readFile(skillPath, "utf8");

  if (!skill.includes("name: bgcut") || !skill.includes("bunx bgcut input.jpg")) {
    throw new Error(`Installed bgcut agent skill is missing its expected contract: ${skillPath}`);
  }

  console.log(
    `npm tarball consumer smoke passed for ${packedName}: Node CLI, local web app, Node API export, and bundled skill.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
