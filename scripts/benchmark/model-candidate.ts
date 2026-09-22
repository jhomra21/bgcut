import { Effect, Schema } from "effect";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { compositeAlphaMask } from "../../src/native/alpha-mask";
import { inspectModelFile } from "../../src/shared/model-file";
import { logitToAlphaByte } from "../../src/shared/matte";
import { resizeRgbaLinearToNchw } from "../../src/shared/preprocess";
import type { BgcutRemovalTimings } from "../../src/node";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  mask: Schema.String,
});

const BenchmarkManifestSchema = Schema.Struct({
  cases: Schema.Array(BenchmarkCaseSchema),
});

type CandidateEngine = "gpu" | "cpu";

type CandidatePostprocess = "bgcut" | "rembg";

type PreparedImage = {
  readonly source: Buffer;
  readonly width: number;
  readonly height: number;
  readonly modelInput: Float32Array;
};

type RemovalResult = {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  readonly timings: BgcutRemovalTimings;
};

type CaseReport = {
  readonly id: string;
  readonly input: string;
  readonly output: string;
  readonly width: number;
  readonly height: number;
  readonly firstRun: BgcutRemovalTimings;
  readonly warmRuns: readonly BgcutRemovalTimings[];
  readonly warmMedian: BgcutRemovalTimings;
};

const usage =
  "Usage: bun run benchmark:model-candidate -- <manifest.json> <output-dir> <model.onnx> <input-size> [gpu|cpu] [warm-repeats] [bgcut|rembg]";

const parseEngine = (value: string): CandidateEngine => {
  if (value === "gpu" || value === "cpu") {
    return value;
  }

  throw new Error(`Unknown engine "${value}". Expected gpu or cpu.`);
};

const parsePostprocess = (value: string): CandidatePostprocess => {
  if (value === "bgcut" || value === "rembg") {
    return value;
  }

  throw new Error(`Unknown postprocess "${value}". Expected bgcut or rembg.`);
};

const parsePositiveInteger = (value: string, label: string): number => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer, received "${value}".`);
  }

  return parsed;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const medianTimings = (
  runs: readonly BgcutRemovalTimings[],
): BgcutRemovalTimings => ({
  totalMs: median(runs.map((run) => run.totalMs)),
  prepareMs: median(runs.map((run) => run.prepareMs)),
  inferenceMs: median(runs.map((run) => run.inferenceMs)),
  encodeMs: median(runs.map((run) => run.encodeMs)),
});

const prepareImage = async (
  path: string,
  inputSize: number,
): Promise<PreparedImage> => {
  const source = await sharp(path)
    .rotate()
    .ensureAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (source.info.channels !== 4) {
    throw new Error(`${path} decoded to ${source.info.channels} channels instead of RGBA.`);
  }

  return {
    source: source.data,
    width: source.info.width,
    height: source.info.height,
    modelInput: resizeRgbaLinearToNchw(
      source.data,
      source.info.width,
      source.info.height,
      inputSize,
      inputSize,
    ),
  };
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

const createBgcutMask = (logits: Float32Array): Uint8Array => {
  const alpha = new Uint8Array(logits.length);

  for (let index = 0; index < logits.length; index += 1) {
    alpha[index] = logitToAlphaByte(logits[index]);
  }

  return alpha;
};

const createRembgMask = (logits: Float32Array): Uint8Array => {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (const logit of logits) {
    const probability = sigmoid(logit);

    minimum = Math.min(minimum, probability);
    maximum = Math.max(maximum, probability);
  }

  const range = maximum - minimum;

  if (!Number.isFinite(range) || range <= Number.EPSILON) {
    return createBgcutMask(logits);
  }

  const alpha = new Uint8Array(logits.length);

  for (let index = 0; index < logits.length; index += 1) {
    const normalized = (sigmoid(logits[index]) - minimum) / range;

    alpha[index] = Math.round(normalized * 255);
  }

  return alpha;
};

const createMask = (
  logits: Float32Array,
  postprocess: CandidatePostprocess,
): Uint8Array =>
  postprocess === "rembg"
    ? createRembgMask(logits)
    : createBgcutMask(logits);

const encodeOutput = async (
  prepared: PreparedImage,
  logits: Float32Array,
  inputSize: number,
  postprocess: CandidatePostprocess,
): Promise<Buffer> => {
  const alpha = createMask(logits, postprocess);
  const resizedAlpha = await sharp(Buffer.from(alpha), {
    raw: {
      width: inputSize,
      height: inputSize,
      channels: 1,
    },
  })
    .resize(prepared.width, prepared.height, {
      fit: "fill",
      kernel: postprocess === "rembg" ? sharp.kernel.lanczos3 : sharp.kernel.cubic,
      fastShrinkOnLoad: false,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.from(prepared.source);

  compositeAlphaMask(rgba, resizedAlpha.data, resizedAlpha.info.channels);

  return sharp(rgba, {
    raw: {
      width: prepared.width,
      height: prepared.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
};

const remove = async (
  session: ort.InferenceSession,
  inputPath: string,
  inputSize: number,
  postprocess: CandidatePostprocess,
): Promise<RemovalResult> => {
  const totalStartedAt = performance.now();
  let stageStartedAt = performance.now();

  const prepared = await prepareImage(inputPath, inputSize);
  const prepareMs = performance.now() - stageStartedAt;
  const inputName = session.inputNames.at(0);
  const outputName = session.outputNames.at(0);

  if (inputName === undefined || outputName === undefined) {
    throw new Error("Candidate model does not expose an input and output tensor.");
  }

  const tensor = new ort.Tensor("float32", prepared.modelInput, [
    1,
    3,
    inputSize,
    inputSize,
  ]);

  stageStartedAt = performance.now();

  const outputs = await session.run({ [inputName]: tensor });
  const inferenceMs = performance.now() - stageStartedAt;
  const output = outputs[outputName];

  if (output === undefined || !(output.data instanceof Float32Array)) {
    throw new Error("Candidate model did not return float32 logits in its first output.");
  }

  const expectedLogits = inputSize * inputSize;

  if (output.data.length !== expectedLogits) {
    throw new Error(
      `Candidate model returned ${output.data.length} logits; expected ${expectedLogits} for ${inputSize}x${inputSize}.`,
    );
  }

  stageStartedAt = performance.now();

  const data = await encodeOutput(prepared, output.data, inputSize, postprocess);
  const encodeMs = performance.now() - stageStartedAt;

  return {
    data,
    width: prepared.width,
    height: prepared.height,
    timings: {
      totalMs: performance.now() - totalStartedAt,
      prepareMs,
      inferenceMs,
      encodeMs,
    },
  };
};

const [
  manifestArgument,
  outputArgument,
  modelArgument,
  inputSizeArgument,
  engineArgument = "gpu",
  repeatsArgument = "5",
  postprocessArgument = "rembg",
] = process.argv.slice(2);

if (
  manifestArgument === undefined ||
  outputArgument === undefined ||
  modelArgument === undefined ||
  inputSizeArgument === undefined
) {
  throw new Error(usage);
}

const manifestPath = resolve(manifestArgument);

const manifestRoot = dirname(manifestPath);

const outputRoot = resolve(outputArgument);

const modelPath = resolve(modelArgument);

const inputSize = parsePositiveInteger(inputSizeArgument, "Input size");

const requestedEngine = parseEngine(engineArgument);

const warmRepeats = parsePositiveInteger(repeatsArgument, "Warm repeats");

const postprocess = parsePostprocess(postprocessArgument);

const manifest = Schema.decodeUnknownSync(BenchmarkManifestSchema)(
  JSON.parse(await readFile(manifestPath, "utf8")),
);

if (manifest.cases.length === 0) {
  throw new Error("Benchmark manifest must contain at least one case.");
}

const modelFingerprint = await Effect.runPromise(inspectModelFile(modelPath));

if (modelFingerprint === undefined) {
  throw new Error(`Candidate model does not exist at ${modelPath}.`);
}

await mkdir(outputRoot, { recursive: true });

const provider = requestedEngine === "gpu" ? "webgpu" : "cpu";
const setupStartedAt = performance.now();

const session = await ort.InferenceSession.create(modelPath, {
  executionProviders: [provider],
  graphOptimizationLevel: "all",
});

const setupMs = performance.now() - setupStartedAt;
const caseReports: CaseReport[] = [];

try {
  for (const benchmarkCase of manifest.cases) {
    const inputPath = resolve(manifestRoot, benchmarkCase.input);
    const outputName = `${benchmarkCase.id.replaceAll("/", "__").replaceAll("\\", "__")}.png`;
    const outputPath = join(outputRoot, outputName);
    const firstResult = await remove(
      session,
      inputPath,
      inputSize,
      postprocess,
    );

    await writeFile(outputPath, firstResult.data);

    const warmRuns: BgcutRemovalTimings[] = [];

    for (let run = 0; run < warmRepeats; run += 1) {
      const warmResult = await remove(
        session,
        inputPath,
        inputSize,
        postprocess,
      );

      warmRuns.push(warmResult.timings);
    }

    caseReports.push({
      id: benchmarkCase.id,
      input: benchmarkCase.input,
      output: outputName,
      width: firstResult.width,
      height: firstResult.height,
      firstRun: firstResult.timings,
      warmRuns,
      warmMedian: medianTimings(warmRuns),
    });
  }
} finally {
  await session.release();
}

const report = {
  schemaVersion: 1,
  tool: "bgcut-model-candidate",
  generatedAt: new Date().toISOString(),
  runtime: {
    platform: process.platform,
    arch: process.arch,
    bun: process.versions.bun ?? null,
    node: process.versions.node,
    onnxRuntime: ort.env.versions?.common ?? null,
  },
  model: {
    filename: basename(modelPath),
    sizeBytes: modelFingerprint.sizeBytes,
    sha256: modelFingerprint.sha256,
    inputWidth: inputSize,
    inputHeight: inputSize,
  },
  requestedEngine,
  provider,
  postprocess,
  setupMs,
  warmRepeats,
  session: {
    inputs: session.inputNames,
    outputs: session.outputNames,
  },
  cases: caseReports,
};

const reportPath = join(outputRoot, "timings.json");

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `Wrote ${caseReports.length} candidate-model outputs to ${outputRoot} with ${provider} and ${postprocess} postprocessing.`,
);

console.log(`Timing report: ${reportPath}`);
