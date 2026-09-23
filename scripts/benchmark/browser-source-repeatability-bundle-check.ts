import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  resolve,
} from "node:path";

const root =
  await mkdtemp(
    join(
      tmpdir(),
      "bgcut-source-repeatability-bundle-",
    ),
  );

const manifestPath =
  join(
    root,
    "manifest.json",
  );

const outputRoot =
  join(
    root,
    "output",
  );

try {
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      cases: [
        {
          id:
            "dog-blind-dog",
          input:
            "input.jpg",
          mask:
            "mask.png",
        },
      ],
    })}\n`,
  );

  const process =
    Bun.spawn(
      [
        "bun",
        "run",
        "scripts/benchmark/browser-source-repeatability-server.ts",
        manifestPath,
        outputRoot,
        "3",
        "4185",
        "dog-blind-dog",
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
          BGCUT_BROWSER_SOURCE_REPEATABILITY_BUILD_ONLY:
            "1",
        },
        stdin:
          "ignore",
        stdout:
          "pipe",
        stderr:
          "pipe",
      },
    );

  const [
    stdout,
    stderr,
    exitCode,
  ] =
    await Promise.all([
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
      `Browser source-repeatability bundle check exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }

  if (
    !stdout.includes(
      "Browser source-repeatability bundle check passed.",
    )
  ) {
    throw new Error(
      `Browser source-repeatability bundle check did not report success.\n${stdout}`,
    );
  }

  console.log(
    "Browser source-repeatability bundle check passed.",
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
