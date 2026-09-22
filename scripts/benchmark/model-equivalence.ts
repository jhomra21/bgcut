import * as ort from "onnxruntime-node";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const usage =
  "Usage: bun run benchmark:model-equivalence -- <original.onnx> <rewritten.onnx> <input-size> [report.json]";

const parseInputSize = (value: string): number => {
  const inputSize = Number.parseInt(value, 10);

  if (!Number.isInteger(inputSize) || inputSize < 1) {
    throw new Error(`Input size must be a positive integer, received "${value}".`);
  }

  return inputSize;
};

const createInput = (inputSize: number): Float32Array => {
  const values = new Float32Array(3 * inputSize * inputSize);
  let state = 0x243f6a88;

  for (let index = 0; index < values.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    values[index] = (state / 0xffff_ffff) * 4 - 2;
  }

  return values;
};

const runModel = async (
  modelPath: string,
  input: Float32Array,
  inputSize: number,
) => {
  const setupStartedAt = performance.now();

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });

  const setupMs = performance.now() - setupStartedAt;

  try {
    const inputName = session.inputNames.at(0);
    const outputName = session.outputNames.at(0);

    if (inputName === undefined || outputName === undefined) {
      throw new Error(`${modelPath} does not expose an input and output tensor.`);
    }

    const tensor = new ort.Tensor("float32", input, [
      1,
      3,
      inputSize,
      inputSize,
    ]);
    const runStartedAt = performance.now();

    const outputs = await session.run({ [inputName]: tensor });
    const runMs = performance.now() - runStartedAt;
    const output = outputs[outputName];

    if (output === undefined || !(output.data instanceof Float32Array)) {
      throw new Error(`${modelPath} did not return float32 output.`);
    }

    return {
      setupMs,
      runMs,
      output: new Float32Array(output.data),
    };
  } finally {
    await session.release();
  }
};

const compare = (
  original: Float32Array,
  rewritten: Float32Array,
) => {
  if (original.length !== rewritten.length) {
    throw new Error(
      `Output lengths differ: original=${original.length}, rewritten=${rewritten.length}.`,
    );
  }

  let maxAbsoluteDifference = 0;
  let sumAbsoluteDifference = 0;
  let differingValues = 0;

  for (let index = 0; index < original.length; index += 1) {
    const difference = Math.abs(original[index] - rewritten[index]);

    maxAbsoluteDifference = Math.max(maxAbsoluteDifference, difference);
    sumAbsoluteDifference += difference;

    if (difference !== 0) {
      differingValues += 1;
    }
  }

  return {
    values: original.length,
    differingValues,
    maxAbsoluteDifference,
    meanAbsoluteDifference: sumAbsoluteDifference / original.length,
  };
};

const [
  originalArgument,
  rewrittenArgument,
  inputSizeArgument,
  reportArgument = "model-equivalence.json",
] = process.argv.slice(2);

if (
  originalArgument === undefined ||
  rewrittenArgument === undefined ||
  inputSizeArgument === undefined
) {
  throw new Error(usage);
}

const originalPath = resolve(originalArgument);

const rewrittenPath = resolve(rewrittenArgument);

const reportPath = resolve(reportArgument);

const inputSize = parseInputSize(inputSizeArgument);

const input = createInput(inputSize);

const original = await runModel(originalPath, input, inputSize);

const rewritten = await runModel(rewrittenPath, input, inputSize);

const comparison = compare(original.output, rewritten.output);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  input: {
    dimensions: [1, 3, inputSize, inputSize],
    generator: "lcg-1664525-1013904223-seed-0x243f6a88",
  },
  original: {
    path: originalPath,
    setupMs: original.setupMs,
    runMs: original.runMs,
  },
  rewritten: {
    path: rewrittenPath,
    setupMs: rewritten.setupMs,
    runMs: rewritten.runMs,
  },
  comparison,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(comparison, null, 2));

console.log(`Equivalence report: ${reportPath}`);
