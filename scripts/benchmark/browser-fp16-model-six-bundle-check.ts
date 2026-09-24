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
      "bgcut-fp16-six-bundle-",
    ),
  );

const manifestPath =
  join(
    root,
    "manifest.json",
  );

const fp32ModelPath =
  join(
    root,
    "fp32.onnx",
  );

const fp16ModelPath =
  join(
    root,
    "fp16.onnx",
  );

const outputRoot =
  join(
    root,
    "output",
  );

try {
  const cases =
    Array.from(
      {
        length: 6,
      },
      (
        _,
        index,
      ) => ({
        id:
          `case-${index}`,
        input:
          `case-${index}.png`,
        mask:
          `case-${index}-mask.png`,
      }),
    );

  await Promise.all([
    writeFile(
      manifestPath,
      `${JSON.stringify({
        cases,
      })}\n`,
    ),
    writeFile(
      fp32ModelPath,
      new Uint8Array(),
    ),
    writeFile(
      fp16ModelPath,
      new Uint8Array(),
    ),
  ]);

  const process =
    Bun.spawn(
      [
        "bun",
        "run",
        "scripts/benchmark/browser-fp16-model-six-server.ts",
        manifestPath,
        outputRoot,
        fp32ModelPath,
        fp16ModelPath,
        "3",
        "1000",
        "4185",
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
                entry[
                  1
                ] !==
                undefined,
            ),
          ),
          BGCUT_BROWSER_FP16_MODEL_SIX_BUILD_ONLY:
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
    exitCode !==
    0
  ) {
    throw new Error(
      `Browser FP16 six-image bundle check exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }

  if (
    !stdout.includes(
      "Browser FP16 six-image bundle check passed.",
    )
  ) {
    throw new Error(
      `Browser FP16 six-image bundle check did not report success.\n${stdout}`,
    );
  }

  console.log(
    "Browser FP16 six-image bundle check passed.",
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
