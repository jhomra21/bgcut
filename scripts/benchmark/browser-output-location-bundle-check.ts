import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root =
  await mkdtemp(
    join(
      tmpdir(),
      "bgcut-output-location-bundle-",
    ),
  );

const manifestPath = join(
  root,
  "manifest.json",
);

const modelPath = join(
  root,
  "model.onnx",
);

const outputRoot = join(
  root,
  "output",
);

try {
  await Promise.all([
    writeFile(
      manifestPath,
      `${JSON.stringify({
        cases: [
          {
            id: "bundle-check",
            input: "input.png",
            mask: "mask.png",
          },
        ],
      })}\n`,
    ),
    writeFile(
      modelPath,
      new Uint8Array(),
    ),
  ]);

  const process = Bun.spawn(
    [
      "bun",
      "run",
      "scripts/benchmark/browser-output-location-server.ts",
      manifestPath,
      outputRoot,
      modelPath,
      "1",
      "4187",
    ],
    {
      cwd: resolve(
        import.meta.dir,
        "../..",
      ),
      env: {
        ...Object.fromEntries(
          Object.entries(
            Bun.env,
          ).filter(
            (
              entry,
            ): entry is [
              string,
              string,
            ] =>
              entry[1] !==
              undefined,
          ),
        ),
        BGCUT_BROWSER_OUTPUT_LOCATION_BUILD_ONLY:
          "1",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [
    stdout,
    stderr,
    exitCode,
  ] = await Promise.all([
    new Response(
      process.stdout,
    ).text(),
    new Response(
      process.stderr,
    ).text(),
    process.exited,
  ]);

  if (
    exitCode !== 0
  ) {
    throw new Error(
      `Browser output-location bundle check exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }

  if (
    !stdout.includes(
      "Browser output-location bundle check passed.",
    )
  ) {
    throw new Error(
      `Browser output-location bundle check did not report success.\n${stdout}`,
    );
  }

  console.log(
    "Browser output-location bundle check passed.",
  );
} finally {
  await rm(
    root,
    {
      recursive: true,
      force: true,
    },
  );
}
