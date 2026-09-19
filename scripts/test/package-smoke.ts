import { Schema } from "effect";
import sharp from "sharp";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  MODEL_FILENAME,
  MODEL_PUBLIC_PATH,
  MODEL_SIZE_BYTES,
} from "../../src/core/model";

type RunOptions = {
  readonly env?: NodeJS.ProcessEnv;
};

const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  options: RunOptions = {},
): string => {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: options.env,
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

const LocalServerStartup = Schema.Struct({
  url: Schema.String,
  host: Schema.Literal("127.0.0.1"),
  port: Schema.Number,
  pid: Schema.Number,
});

const LocalServerHealth = Schema.Struct({
  ok: Schema.Literal(true),
  service: Schema.Literal("bgcut-local"),
});

const root = process.cwd();

const temporaryRoot = await mkdtemp(join(tmpdir(), "bgcut-package-smoke-"));

try {
  const packageDirectory = join(temporaryRoot, "package");
  const consumerDirectory = join(temporaryRoot, "consumer");
  const smokeHome = join(temporaryRoot, "home");
  const smokeCache = join(temporaryRoot, "cache");
  const smokeLocalAppData = join(temporaryRoot, "local-app-data");

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

  const modelCacheRoot = (() => {
    if (process.platform === "darwin") {
      return join(smokeHome, "Library", "Caches", "bgcut");
    }

    if (process.platform === "win32") {
      return join(smokeLocalAppData, "bgcut");
    }

    return join(smokeCache, "bgcut");
  })();

  const cachedModelPath = join(modelCacheRoot, "models", MODEL_FILENAME);

  await mkdir(dirname(cachedModelPath), { recursive: true });
  await copyFile(
    join(root, "public", "models", MODEL_FILENAME),
    cachedModelPath,
  );

  const smokeEnvironment = {
    ...process.env,
    HOME: smokeHome,
    USERPROFILE: smokeHome,
    XDG_CACHE_HOME: smokeCache,
    LOCALAPPDATA: smokeLocalAppData,
  };

  const inputPath = join(temporaryRoot, "input.png");

  await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 28, g: 112, b: 196 },
    },
  })
    .png()
    .toFile(inputPath);

  const localApp = spawn(binPath, ["serve", "--json"], {
    cwd: consumerDirectory,
    env: smokeEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const startupLine = await readFirstLine(localApp, 15_000);

    const startup = Schema.decodeUnknownSync(LocalServerStartup)(
      JSON.parse(startupLine),
    );

    if (startup.port <= 0) {
      throw new Error(`Unexpected bgcut local-server port: ${startup.port}`);
    }

    const page = await fetch(startup.url);
    const pageHtml = await page.text();

    if (
      !page.ok ||
      !pageHtml.includes("bgcut") ||
      !pageHtml.includes('<meta name="bgcut-runtime" content="local" />')
    ) {
      throw new Error(`Packaged bgcut local app was not served from ${startup.url}.`);
    }

    const docsRoute = await fetch(new URL("/docs", startup.url), {
      redirect: "manual",
    });

    if (docsRoute.status !== 302 || docsRoute.headers.get("location") !== "/") {
      throw new Error("Packaged bgcut local app exposed a non-root site route.");
    }

    const health = await fetch(new URL("/health", startup.url));

    const healthBody = Schema.decodeUnknownSync(LocalServerHealth)(
      await health.json(),
    );

    if (!health.ok || !healthBody.ok) {
      throw new Error(`Packaged bgcut health route failed at ${startup.url}health.`);
    }

    const model = await fetch(new URL(MODEL_PUBLIC_PATH, startup.url), {
      method: "HEAD",
    });

    if (
      !model.ok ||
      Number(model.headers.get("content-length")) !== MODEL_SIZE_BYTES
    ) {
      throw new Error(
        `Packaged Node server could not inspect and serve the cached model at ${startup.url}.`,
      );
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

  const cliOutputPath = join(temporaryRoot, "cli-output.png");

  const cliOutput = run(
    binPath,
    [inputPath, "--cpu", "-o", cliOutputPath],
    consumerDirectory,
    { env: smokeEnvironment },
  );

  if (!cliOutput.includes("✓ cpu") || (await stat(cliOutputPath)).size <= 0) {
    throw new Error(`Installed Node CLI did not complete a real CPU inference:\n${cliOutput}`);
  }

  const apiSmokePath = join(consumerDirectory, "api-smoke.mjs");
  const apiOutputPath = join(temporaryRoot, "api-output.webp");

  await writeFile(
    apiSmokePath,
    `import { writeFile } from "node:fs/promises";
import { createBgcut } from "bgcut";

const bgcut = await createBgcut({ engine: "cpu" });

try {
  const first = await bgcut.remove(process.argv[2]);
  const second = await bgcut.remove(process.argv[2], { format: "webp" });

  if (
    bgcut.engine !== "cpu" ||
    first.engine !== "cpu" ||
    second.engine !== "cpu" ||
    first.data.length === 0 ||
    second.data.length === 0
  ) {
    process.exit(2);
  }

  await writeFile(process.argv[3], second.data);
} finally {
  await bgcut.close();
}
`,
  );

  run(
    process.execPath,
    [apiSmokePath, inputPath, apiOutputPath],
    consumerDirectory,
    { env: smokeEnvironment },
  );

  if ((await stat(apiOutputPath)).size <= 0) {
    throw new Error("Installed Node API did not complete reusable-session inference.");
  }

  const skillPath = join(consumerDirectory, "node_modules", "bgcut", "skills", "bgcut", "SKILL.md");
  const skill = await readFile(skillPath, "utf8");

  if (
    !skill.includes("name: bgcut") ||
    !skill.includes("npx bgcut input.jpg") ||
    !skill.includes("bgcut serve --json") ||
    !skill.includes('import { createBgcut } from "bgcut"') ||
    !skill.includes("share the same validated model cache") ||
    skill.includes("The installed CLI currently requires Bun.")
  ) {
    throw new Error(`Installed bgcut agent skill is missing its current package contract: ${skillPath}`);
  }

  console.log(
    `npm tarball consumer smoke passed for ${packedName}: Node CLI inference, local web app, cached model route, reusable Node API inference, and bundled skill.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
