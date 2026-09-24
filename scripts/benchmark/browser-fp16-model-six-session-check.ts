import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  resolve,
} from "node:path";

const port =
  4187;

const baseUrl =
  `http://127.0.0.1:${port}/`;

const root =
  await mkdtemp(
    join(
      tmpdir(),
      "bgcut-fp16-six-session-",
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

const sessionToken =
  `session-${crypto.randomUUID()}`;

const firstLaunch =
  `launch-${crypto.randomUUID()}`;

const secondLaunch =
  `launch-${crypto.randomUUID()}`;

const readPipe = (
  pipe:
    | number
    | ReadableStream<Uint8Array>
    | undefined,
): Promise<string> =>
  pipe instanceof
    ReadableStream
    ? new Response(
        pipe,
      ).text()
    : Promise.resolve(
        "",
      );

const expectStatus = (
  response: Response,
  status: number,
  label: string,
): void => {
  if (
    response.status !==
    status
  ) {
    throw new Error(
      `${label} returned HTTP ${response.status}; expected ${status}.`,
    );
  }
};

const timings = {
  decodeMs: 0,
  runtimeMs: 0,
  modelDownloadMs: 0,
  sessionInitMs: 0,
  preprocessMs: 0,
  inputUploadMs: 0,
  inferenceMs: 0,
  outputReadbackMs: 0,
  matteMs: 0,
  compositeMs: 0,
  exportMs: 0,
  totalMs: 0,
  sessionReused: false,
};

let server:
  | ReturnType<
      typeof Bun.spawn
    >
  | undefined;

let stdout =
  Promise.resolve(
    "",
  );

let stderr =
  Promise.resolve(
    "",
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

  server =
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
        String(
          port,
        ),
        sessionToken,
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
          BGCUT_BROWSER_FP16_MODEL_SIX_SESSION_CHECK:
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

  stdout =
    readPipe(
      server.stdout,
    );

  stderr =
    readPipe(
      server.stderr,
    );

  const deadline =
    Date.now() +
    20_000;

  let ready =
    false;

  while (
    Date.now() <
    deadline
  ) {
    try {
      const response =
        await fetch(
          baseUrl,
        );

      if (
        response.ok
      ) {
        const body =
          await response.text();

        if (
          body.includes(
            "<script",
          )
        ) {
          throw new Error(
            "The bare health URL still serves executable benchmark HTML.",
          );
        }

        ready =
          true;

        break;
      }
    } catch {
      // The server is still starting.
    }

    if (
      server.exitCode !==
      null
    ) {
      throw new Error(
        `Session-check server exited with code ${server.exitCode}.`,
      );
    }

    await Bun.sleep(
      100,
    );
  }

  if (
    !ready
  ) {
    throw new Error(
      "Session-check server did not become ready.",
    );
  }

  const staleBeforeActivation =
    await fetch(
      `${baseUrl}session/${encodeURIComponent(
        sessionToken,
      )}?block=0&launch=stale`,
    );

  expectStatus(
    staleBeforeActivation,
    404,
    "Stale page before activation",
  );

  const activateFirst =
    await fetch(
      `${baseUrl}activate`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-bgcut-benchmark-session":
            sessionToken,
        },
        body:
          JSON.stringify({
            launchToken:
              firstLaunch,
            blockIndex: 0,
            primeOnly:
              true,
          }),
      },
    );

  expectStatus(
    activateFirst,
    200,
    "First launch activation",
  );

  const authorizedPage =
    await fetch(
      `${baseUrl}session/${encodeURIComponent(
        sessionToken,
      )}?block=0&launch=${encodeURIComponent(
        firstLaunch,
      )}&primeOnly=1`,
    );

  expectStatus(
    authorizedPage,
    200,
    "Authorized session page",
  );

  if (
    !(
      await authorizedPage.text()
    ).includes(
      "/client.js?session=",
    )
  ) {
    throw new Error(
      "Authorized session page did not contain the benchmark client.",
    );
  }

  const authorizedConfig =
    await fetch(
      `${baseUrl}config.json?session=${encodeURIComponent(
        sessionToken,
      )}&launch=${encodeURIComponent(
        firstLaunch,
      )}&block=0`,
    );

  expectStatus(
    authorizedConfig,
    200,
    "Authorized config",
  );

  const staleConfig =
    await fetch(
      `${baseUrl}config.json?session=${encodeURIComponent(
        sessionToken,
      )}&launch=stale&block=0`,
    );

  expectStatus(
    staleConfig,
    404,
    "Stale config",
  );

  const unauthorizedRun =
    await fetch(
      `${baseUrl}run`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-bgcut-benchmark-session":
            sessionToken,
        },
        body:
          "{}",
      },
    );

  expectStatus(
    unauthorizedRun,
    403,
    "Run without launch token",
  );

  const prime =
    await fetch(
      `${baseUrl}prime`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-bgcut-benchmark-session":
            sessionToken,
          "x-bgcut-benchmark-launch":
            firstLaunch,
        },
        body:
          JSON.stringify({
            schemaVersion: 1,
            blockIndex: 0,
            sequence:
              "fp32-first",
            direction:
              "forward",
            mode:
              "fp32",
            caseId:
              "case-0",
            timings,
          }),
      },
    );

  expectStatus(
    prime,
    200,
    "Authorized prewarm prime",
  );

  const primePath =
    join(
      outputRoot,
      "runs",
      "block-0",
      "prime.json",
    );

  if (
    !(await Bun.file(
      primePath,
    ).exists())
  ) {
    throw new Error(
      "Authorized prewarm did not persist prime.json.",
    );
  }

  const persistedPrime =
    JSON.parse(
      await readFile(
        primePath,
        "utf8",
      ),
    ) as {
      readonly blockIndex?: number;
    };

  if (
    persistedPrime.blockIndex !==
    0
  ) {
    throw new Error(
      "Persisted prewarm prime belongs to the wrong block.",
    );
  }

  const expiredRun =
    await fetch(
      `${baseUrl}run`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-bgcut-benchmark-session":
            sessionToken,
          "x-bgcut-benchmark-launch":
            firstLaunch,
        },
        body:
          "{}",
      },
    );

  expectStatus(
    expiredRun,
    403,
    "Expired prewarm launch",
  );

  const activateSecond =
    await fetch(
      `${baseUrl}activate`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-bgcut-benchmark-session":
            sessionToken,
        },
        body:
          JSON.stringify({
            launchToken:
              secondLaunch,
            blockIndex: 2,
            primeOnly:
              true,
          }),
      },
    );

  expectStatus(
    activateSecond,
    200,
    "Second launch activation",
  );

  const wrongBlock =
    await fetch(
      `${baseUrl}session/${encodeURIComponent(
        sessionToken,
      )}?block=3&launch=${encodeURIComponent(
        secondLaunch,
      )}&primeOnly=1`,
    );

  expectStatus(
    wrongBlock,
    404,
    "Wrong active block",
  );

  const correctBlock =
    await fetch(
      `${baseUrl}session/${encodeURIComponent(
        sessionToken,
      )}?block=2&launch=${encodeURIComponent(
        secondLaunch,
      )}&primeOnly=1`,
    );

  expectStatus(
    correctBlock,
    200,
    "Correct active block",
  );

  console.log(
    "Browser FP16 six-image session contract check passed.",
  );
} finally {
  if (
    server !==
    undefined
  ) {
    server.kill();

    await Promise.all([
      stdout,
      stderr,
    ]);
  }

  await rm(
    root,
    {
      recursive: true,
      force: true,
    },
  );
}
