import { Schema } from "effect";
import sharp from "sharp";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  MODEL_FILENAME,
  MODEL_PUBLIC_PATH,
} from "../../src/shared/model-config";
import { ORT_WEBGPU_WASM_PUBLIC_PATH } from "../../src/shared/ort-assets";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const BenchmarkManifestSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
});

const usage =
  "Usage: bun run benchmark:browser-composite -- <manifest.json> <output-dir> <model.onnx> [warm-repeats] [port]";

const parsePositiveInteger = (
  value: string,
  label: string,
): number => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `${label} must be a positive integer, received "${value}".`,
    );
  }

  return parsed;
};

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  repeatsArgument = "5",
  portArgument = "4180",
] = process.argv.slice(2);

if (
  manifestArgument === undefined ||
  outputArgument === undefined ||
  modelArgument === undefined
) {
  throw new Error(usage);
}

const manifestPath = resolve(manifestArgument);

const manifestRoot = dirname(manifestPath);

const outputRoot = resolve(outputArgument);

const cpuOutputRoot = join(outputRoot, "cpu");

const gpuOutputRoot = join(outputRoot, "gpu");

const modelPath = resolve(modelArgument);

const modelFile = Bun.file(modelPath);

if (!(await modelFile.exists())) {
  throw new Error(
    `Production model does not exist at ${modelPath}.`,
  );
}

const warmRepeats = parsePositiveInteger(
  repeatsArgument,
  "Warm repeats",
);

const port = parsePositiveInteger(
  portArgument,
  "Port",
);

const manifest = Schema.decodeUnknownSync(
  BenchmarkManifestSchema,
)(
  JSON.parse(
    await readFile(manifestPath, "utf8"),
  ),
);

if (manifest.cases.length === 0) {
  throw new Error(
    "Benchmark manifest must contain at least one case.",
  );
}

await Promise.all([
  mkdir(outputRoot, { recursive: true }),
  mkdir(cpuOutputRoot, { recursive: true }),
  mkdir(gpuOutputRoot, { recursive: true }),
]);

const build = await Bun.build({
  entrypoints: [
    join(
      import.meta.dir,
      "browser-composite-client.ts",
    ),
  ],
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "inline",
});

if (!build.success) {
  const messages = build.logs
    .map((log) => log.message)
    .join("\n");

  throw new Error(
    `Could not build browser composite benchmark.\n${messages}`,
  );
}

const clientOutput = build.outputs.at(0);

if (clientOutput === undefined) {
  throw new Error(
    "Browser composite benchmark produced no bundle.",
  );
}

const clientSource = await clientOutput.text();

const runtimePath = resolve(
  import.meta.dir,
  "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
);

const runtimeFile = Bun.file(runtimePath);

if (!(await runtimeFile.exists())) {
  throw new Error(
    `ONNX Runtime WebGPU runtime is missing at ${runtimePath}.`,
  );
}

if (
  process.env.BGCUT_BROWSER_COMPOSITE_BUILD_ONLY ===
  "1"
) {
  console.log(
    "Browser composite benchmark bundle check passed.",
  );

  process.exit(0);
}

const safeOutputName = (id: string): string =>
  `${id
    .replaceAll("/", "__")
    .replaceAll("\\", "__")}.png`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>bgcut GPU composite benchmark</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      body {
        max-width: 920px;
        margin: 40px auto;
        padding: 0 24px;
      }

      pre {
        white-space: pre-wrap;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <h1>bgcut GPU composite benchmark</h1>
    <pre id="status"></pre>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const config = {
  warmRepeats,
  cases: manifest.cases.map(
    (benchmarkCase, index) => ({
      id: benchmarkCase.id,
      inputUrl: `/input/${index}`,
    }),
  ),
};

const runScore = async (
  mode: "cpu" | "gpu",
): Promise<void> => {
  const modeRoot =
    mode === "cpu"
      ? cpuOutputRoot
      : gpuOutputRoot;

  const process = Bun.spawn(
    [
      "bun",
      "run",
      "benchmark:score",
      "--",
      manifestPath,
      modeRoot,
      join(modeRoot, "quality.json"),
    ],
    {
      cwd: resolve(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdout =
    await new Response(process.stdout).text();

  const stderr =
    await new Response(process.stderr).text();

  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(
      `${mode} quality scorer exited with code ${exitCode}.\n${stderr || stdout}`,
    );
  }
};

type PixelComparison = {
  readonly schemaVersion: 1;
  readonly pixels: number;
  readonly alpha: {
    readonly meanAbsoluteByteDifference: number;
    readonly maxAbsoluteByteDifference: number;
    readonly differingPixels: number;
    readonly differingPixelFraction: number;
    readonly pixelsOverOneByte: number;
    readonly pixelsOverOneByteFraction: number;
  };
  readonly visibleRgb: {
    readonly meanAbsoluteByteDifference: number;
    readonly maxAbsoluteByteDifference: number;
    readonly comparedValues: number;
  };
};

const compareOutputs = async (): Promise<PixelComparison> => {
  let alphaAbsolute = 0;
  let alphaMaximum = 0;
  let alphaDifferent = 0;
  let alphaOverOne = 0;
  let rgbAbsolute = 0;
  let rgbMaximum = 0;
  let visibleRgbValues = 0;
  let pixels = 0;

  for (const benchmarkCase of manifest.cases) {
    const name = safeOutputName(benchmarkCase.id);

    const [cpu, gpu] = await Promise.all([
      sharp(join(cpuOutputRoot, name))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(join(gpuOutputRoot, name))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ]);

    if (
      cpu.info.width !== gpu.info.width ||
      cpu.info.height !== gpu.info.height ||
      cpu.info.channels !== 4 ||
      gpu.info.channels !== 4
    ) {
      throw new Error(
        `CPU/GPU output dimensions differ for ${benchmarkCase.id}.`,
      );
    }

    const casePixels =
      cpu.info.width * cpu.info.height;

    for (
      let pixel = 0;
      pixel < casePixels;
      pixel += 1
    ) {
      const index = pixel * 4;
      const cpuAlpha = cpu.data[index + 3];
      const gpuAlpha = gpu.data[index + 3];

      const alphaDifference =
        Math.abs(cpuAlpha - gpuAlpha);

      alphaAbsolute += alphaDifference;
      alphaMaximum = Math.max(
        alphaMaximum,
        alphaDifference,
      );

      if (alphaDifference !== 0) {
        alphaDifferent += 1;
      }

      if (alphaDifference > 1) {
        alphaOverOne += 1;
      }

      if (Math.max(cpuAlpha, gpuAlpha) > 0) {
        for (
          let channel = 0;
          channel < 3;
          channel += 1
        ) {
          const difference = Math.abs(
            cpu.data[index + channel] -
            gpu.data[index + channel],
          );

          rgbAbsolute += difference;
          rgbMaximum = Math.max(
            rgbMaximum,
            difference,
          );
          visibleRgbValues += 1;
        }
      }
    }

    pixels += casePixels;
  }

  return {
    schemaVersion: 1,
    pixels,
    alpha: {
      meanAbsoluteByteDifference:
        alphaAbsolute / pixels,
      maxAbsoluteByteDifference: alphaMaximum,
      differingPixels: alphaDifferent,
      differingPixelFraction:
        alphaDifferent / pixels,
      pixelsOverOneByte: alphaOverOne,
      pixelsOverOneByteFraction:
        alphaOverOne / pixels,
    },
    visibleRgb: {
      meanAbsoluteByteDifference:
        visibleRgbValues === 0
          ? 0
          : rgbAbsolute / visibleRgbValues,
      maxAbsoluteByteDifference: rgbMaximum,
      comparedValues: visibleRgbValues,
    },
  };
};

const app = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return new Response(html, {
        headers: {
          "content-type":
            "text/html; charset=utf-8",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/client.js"
    ) {
      return new Response(clientSource, {
        headers: {
          "content-type":
            "text/javascript; charset=utf-8",
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/config.json"
    ) {
      return Response.json(config);
    }

    if (
      request.method === "GET" &&
      url.pathname === MODEL_PUBLIC_PATH
    ) {
      return new Response(modelFile, {
        headers: {
          "content-type":
            "application/octet-stream",
          "cache-control": "no-store",
          "x-bgcut-model": MODEL_FILENAME,
        },
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === ORT_WEBGPU_WASM_PUBLIC_PATH
    ) {
      return new Response(runtimeFile, {
        headers: {
          "content-type": "application/wasm",
          "cache-control": "no-store",
        },
      });
    }

    const inputMatch =
      url.pathname.match(/^\/input\/(\d+)$/u);

    if (
      request.method === "GET" &&
      inputMatch !== null
    ) {
      const index = Number.parseInt(
        inputMatch[1],
        10,
      );

      const benchmarkCase =
        manifest.cases.at(index);

      if (benchmarkCase === undefined) {
        return new Response(
          "Unknown benchmark input.",
          { status: 404 },
        );
      }

      return new Response(
        Bun.file(
          resolve(
            manifestRoot,
            benchmarkCase.input,
          ),
        ),
        {
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    }

    const outputMatch =
      url.pathname.match(
        /^\/output\/(cpu|gpu)\/(\d+)$/u,
      );

    if (
      request.method === "POST" &&
      outputMatch !== null
    ) {
      const mode = outputMatch[1];

      if (mode !== "cpu" && mode !== "gpu") {
        return new Response(
          "Unknown benchmark output mode.",
          { status: 404 },
        );
      }

      const index = Number.parseInt(
        outputMatch[2],
        10,
      );

      const benchmarkCase =
        manifest.cases.at(index);

      if (benchmarkCase === undefined) {
        return new Response(
          "Unknown benchmark output.",
          { status: 404 },
        );
      }

      const targetRoot =
        mode === "cpu"
          ? cpuOutputRoot
          : gpuOutputRoot;

      const targetPath = join(
        targetRoot,
        safeOutputName(benchmarkCase.id),
      );

      await writeFile(
        targetPath,
        new Uint8Array(
          await request.arrayBuffer(),
        ),
      );

      if (mode === "gpu") {
        const stats = await sharp(targetPath)
          .ensureAlpha()
          .stats();

        const alpha = stats.channels.at(3);

        if (alpha === undefined || alpha.max === 0) {
          return new Response(
            "GPU composite output is fully transparent.",
            { status: 422 },
          );
        }
      }

      return new Response("saved");
    }

    if (
      request.method === "POST" &&
      url.pathname === "/failure"
    ) {
      await writeFile(
        join(outputRoot, "browser-failure.json"),
        `${JSON.stringify(
          await request.json(),
          null,
          2,
        )}\n`,
      );

      return new Response("failure recorded");
    }

    if (
      request.method === "POST" &&
      url.pathname === "/report"
    ) {
      const timingReport = await request.json();

      await writeFile(
        join(outputRoot, "browser-timings.json"),
        `${JSON.stringify(
          timingReport,
          null,
          2,
        )}\n`,
      );

      await runScore("cpu");
      await runScore("gpu");

      const comparison =
        await compareOutputs();

      await writeFile(
        join(
          outputRoot,
          "pixel-comparison.json",
        ),
        `${JSON.stringify(
          comparison,
          null,
          2,
        )}\n`,
      );

      return Response.json({
        timings: join(
          outputRoot,
          "browser-timings.json",
        ),
        cpuQuality: join(
          cpuOutputRoot,
          "quality.json",
        ),
        gpuQuality: join(
          gpuOutputRoot,
          "quality.json",
        ),
        comparison: join(
          outputRoot,
          "pixel-comparison.json",
        ),
      });
    }

    return new Response(
      "Not found.",
      { status: 404 },
    );
  },
});

console.log("");

console.log(
  "Browser composite benchmark is ready.",
);

console.log(
  `Open http://${app.hostname}:${app.port}/ in a WebGPU browser.`,
);

console.log(`Outputs: ${outputRoot}`);
