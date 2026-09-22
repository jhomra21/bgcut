import { Schema } from "effect";
import * as ort from "onnxruntime-web/webgpu";

import { logitToAlphaByte } from "../../src/shared/matte";

const BenchmarkCaseSchema = Schema.Struct({
  id: Schema.String,
  inputUrl: Schema.String,
});

const BenchmarkConfigSchema = Schema.Struct({
  modelUrl: Schema.String,
  runtimeUrl: Schema.String,
  inputSize: Schema.Number,
  warmRepeats: Schema.Number,
  cases: Schema.Array(BenchmarkCaseSchema),
});

const diagnosticLogs: string[] = [];

let diagnosticSessionCreated = false;

let diagnosticSessionError = "";

type RunTimings = {
  readonly totalMs: number;
  readonly decodeMs: number;
  readonly inputUploadMs: number;
  readonly inferenceSubmitMs: number;
  readonly outputReadbackMs: number;
  readonly matteMs: number;
  readonly compositeMs: number;
  readonly exportMs: number;
};

type CaseReport = {
  readonly id: string;
  readonly firstRun: RunTimings;
  readonly warmRuns: readonly RunTimings[];
  readonly warmMedian: RunTimings;
};

type PersistentIo = {
  readonly inputBuffer: GPUBuffer;
  readonly inputTensor: ort.Tensor;
  readonly outputBuffer: GPUBuffer;
  readonly outputTensor: ort.Tensor;
};

type PreprocessPipeline = {
  readonly pipeline: GPUComputePipeline;
  readonly layout: GPUBindGroupLayout;
  readonly sampler: GPUSampler;
};

const status = document.querySelector<HTMLPreElement>("#status");

if (status === null) {
  throw new Error("Benchmark status element is missing.");
}

const writeStatus = (message: string): void => {
  status.textContent += `${message}\n`;
};

type DiagnosticConsoleValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | object
  | null
  | undefined;

const captureDiagnosticLog = (
  level: string,
  values: readonly DiagnosticConsoleValue[],
): void => {
  if (diagnosticLogs.length >= 5000) {
    return;
  }

  diagnosticLogs.push(
    `[${level}] ${values.map((value) => String(value)).join(" ")}`,
  );
};

const installConsoleCapture = (): void => {
  const originalDebug = console.debug.bind(console);
  const originalInfo = console.info.bind(console);
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.debug = (...values: DiagnosticConsoleValue[]): void => {
    captureDiagnosticLog("debug", values);
    originalDebug(...values);
  };

  console.info = (...values: DiagnosticConsoleValue[]): void => {
    captureDiagnosticLog("info", values);
    originalInfo(...values);
  };

  console.log = (...values: DiagnosticConsoleValue[]): void => {
    captureDiagnosticLog("log", values);
    originalLog(...values);
  };

  console.warn = (...values: DiagnosticConsoleValue[]): void => {
    captureDiagnosticLog("warn", values);
    originalWarn(...values);
  };

  console.error = (...values: DiagnosticConsoleValue[]): void => {
    captureDiagnosticLog("error", values);
    originalError(...values);
  };
};

installConsoleCapture();


const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const medianTimings = (runs: readonly RunTimings[]): RunTimings => ({
  totalMs: median(runs.map((run) => run.totalMs)),
  decodeMs: median(runs.map((run) => run.decodeMs)),
  inputUploadMs: median(runs.map((run) => run.inputUploadMs)),
  inferenceSubmitMs: median(runs.map((run) => run.inferenceSubmitMs)),
  outputReadbackMs: median(runs.map((run) => run.outputReadbackMs)),
  matteMs: median(runs.map((run) => run.matteMs)),
  compositeMs: median(runs.map((run) => run.compositeMs)),
  exportMs: median(runs.map((run) => run.exportMs)),
});

const requestDevice = async (): Promise<{ readonly adapter: GPUAdapter; readonly device: GPUDevice }> => {
  if (navigator.gpu === undefined) {
    throw new Error("WebGPU is unavailable in this browser.");
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });

  if (adapter === null) {
    throw new Error("No WebGPU adapter is available.");
  }

  const requiredFeatures: GPUFeatureName[] = [];

  const addFeature = (feature: GPUFeatureName): boolean => {
    if (!adapter.features.has(feature)) {
      return false;
    }

    requiredFeatures.push(feature);

    return true;
  };

  // SAFETY: Chromium exposes this exact feature string through GPUAdapter.features when supported.
  const chromiumTimestampQuery =
    "chromium-experimental-timestamp-query-inside-passes" as GPUFeatureName;

  if (!addFeature(chromiumTimestampQuery)) {
    addFeature("timestamp-query");
  }

  addFeature("shader-f16");
  addFeature("subgroups");

  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits: {
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY,
      maxComputeWorkgroupSizeZ: adapter.limits.maxComputeWorkgroupSizeZ,
    },
  });

  return { adapter, device };
};

const createPreprocessPipeline = (
  device: GPUDevice,
  inputSize: number,
): PreprocessPipeline => {
  const pixelCount = inputSize * inputSize;

  const module = device.createShaderModule({
    code: `
      @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
      @group(0) @binding(1) var sourceSampler: sampler;
      @group(0) @binding(2) var<storage, read_write> output: array<f32>;

      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
        if (gid.x >= ${inputSize}u || gid.y >= ${inputSize}u) {
          return;
        }

        let pixelIndex = gid.y * ${inputSize}u + gid.x;
        let uv = (vec2f(f32(gid.x), f32(gid.y)) + vec2f(0.5, 0.5)) / ${inputSize}.0;
        let pixel = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);

        output[pixelIndex] = (pixel.x - 0.485) / 0.229;
        output[${pixelCount}u + pixelIndex] = (pixel.y - 0.456) / 0.224;
        output[${pixelCount * 2}u + pixelIndex] = (pixel.z - 0.406) / 0.225;
      }
    `,
  });

  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        sampler: { type: "filtering" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout],
  });

  const pipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: {
      module,
      entryPoint: "main",
    },
  });

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  return {
    pipeline,
    layout,
    sampler,
  };
};

const createPersistentIo = (
  device: GPUDevice,
  inputSize: number,
): PersistentIo => {
  const inputElements = inputSize * inputSize * 3;
  const outputElements = inputSize * inputSize;

  const inputBuffer = device.createBuffer({
    size: inputElements * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
  });

  const outputBuffer = device.createBuffer({
    size: outputElements * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
  });

  const inputTensor = ort.Tensor.fromGpuBuffer(inputBuffer, {
    dataType: "float32",
    dims: [1, 3, inputSize, inputSize],
  });

  const outputTensor = ort.Tensor.fromGpuBuffer(outputBuffer, {
    dataType: "float32",
    dims: [1, 1, inputSize, inputSize],
  });

  return {
    inputBuffer,
    inputTensor,
    outputBuffer,
    outputTensor,
  };
};

const uploadModelInput = (
  device: GPUDevice,
  bitmap: ImageBitmap,
  inputBuffer: GPUBuffer,
  preprocess: PreprocessPipeline,
  inputSize: number,
): GPUTexture => {
  const sourceTexture = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  try {
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: sourceTexture },
      [bitmap.width, bitmap.height],
    );

    const bindGroup = device.createBindGroup({
      layout: preprocess.layout,
      entries: [
        {
          binding: 0,
          resource: sourceTexture.createView(),
        },
        {
          binding: 1,
          resource: preprocess.sampler,
        },
        {
          binding: 2,
          resource: {
            buffer: inputBuffer,
          },
        },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();

    pass.setPipeline(preprocess.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(inputSize / 16),
      Math.ceil(inputSize / 16),
    );
    pass.end();

    device.queue.submit([encoder.finish()]);

    return sourceTexture;
  } catch (error) {
    sourceTexture.destroy();

    throw error;
  }
};

const readOutput = async (
  device: GPUDevice,
  outputBuffer: GPUBuffer,
  inputSize: number,
): Promise<Float32Array> => {
  const byteLength =
    inputSize *
    inputSize *
    Float32Array.BYTES_PER_ELEMENT;

  const staging = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  try {
    const encoder = device.createCommandEncoder();

    encoder.copyBufferToBuffer(
      outputBuffer,
      0,
      staging,
      0,
      byteLength,
    );
    device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);

    return new Float32Array(staging.getMappedRange().slice(0));
  } finally {
    if (staging.mapState === "mapped") {
      staging.unmap();
    }

    staging.destroy();
  }
};

const createMatte = (
  logits: Float32Array,
  inputSize: number,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");

  canvas.width = inputSize;
  canvas.height = inputSize;

  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("2D canvas is unavailable.");
  }

  const imageData = context.createImageData(inputSize, inputSize);

  for (let pixel = 0; pixel < logits.length; pixel += 1) {
    const rgbaIndex = pixel * 4;

    imageData.data[rgbaIndex] = 255;
    imageData.data[rgbaIndex + 1] = 255;
    imageData.data[rgbaIndex + 2] = 255;
    imageData.data[rgbaIndex + 3] = logitToAlphaByte(logits[pixel]);
  }

  context.putImageData(imageData, 0, 0);

  return canvas;
};

const composite = (
  bitmap: ImageBitmap,
  matte: HTMLCanvasElement,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("2D canvas is unavailable.");
  }

  context.drawImage(bitmap, 0, 0);
  context.globalCompositeOperation = "destination-in";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(matte, 0, 0, bitmap.width, bitmap.height);
  context.globalCompositeOperation = "source-over";

  return canvas;
};

const canvasToPng = (
  canvas: HTMLCanvasElement,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("PNG encoding returned no blob."));

        return;
      }

      resolve(blob);
    }, "image/png");
  });

const runRemoval = async (
  device: GPUDevice,
  session: ort.InferenceSession,
  source: Blob,
  preprocess: PreprocessPipeline,
  io: PersistentIo,
  inputSize: number,
): Promise<{ readonly blob: Blob; readonly timings: RunTimings }> => {
  const totalStartedAt = performance.now();
  let stageStartedAt = performance.now();

  const bitmap = await createImageBitmap(source);

  const decodeMs = performance.now() - stageStartedAt;
  let sourceTexture: GPUTexture | undefined;

  try {
    stageStartedAt = performance.now();

    sourceTexture = uploadModelInput(
      device,
      bitmap,
      io.inputBuffer,
      preprocess,
      inputSize,
    );

    const inputUploadMs = performance.now() - stageStartedAt;
    const inputName = session.inputNames.at(0);
    const outputName = session.outputNames.at(0);

    if (inputName === undefined || outputName === undefined) {
      throw new Error("Candidate model does not expose an input and output tensor.");
    }

    stageStartedAt = performance.now();

    await session.run(
      { [inputName]: io.inputTensor },
      { [outputName]: io.outputTensor },
    );

    const inferenceSubmitMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();

    const logits = await readOutput(
      device,
      io.outputBuffer,
      inputSize,
    );

    const outputReadbackMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();

    const matte = createMatte(logits, inputSize);
    const matteMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();

    const output = composite(bitmap, matte);
    const compositeMs = performance.now() - stageStartedAt;

    stageStartedAt = performance.now();

    const blob = await canvasToPng(output);
    const exportMs = performance.now() - stageStartedAt;

    return {
      blob,
      timings: {
        totalMs: performance.now() - totalStartedAt,
        decodeMs,
        inputUploadMs,
        inferenceSubmitMs,
        outputReadbackMs,
        matteMs,
        compositeMs,
        exportMs,
      },
    };
  } finally {
    sourceTexture?.destroy();
    bitmap.close();
  }
};

const uploadOutput = async (
  caseIndex: number,
  blob: Blob,
): Promise<void> => {
  const response = await fetch(`/output/${caseIndex}`, {
    method: "POST",
    body: blob,
  });

  if (!response.ok) {
    throw new Error(
      `Could not save benchmark output ${caseIndex}: HTTP ${response.status}.`,
    );
  }
};

const main = async (): Promise<void> => {
  const configResponse = await fetch("/config.json");

  if (!configResponse.ok) {
    throw new Error(`Could not load benchmark config: HTTP ${configResponse.status}.`);
  }

  const config = Schema.decodeUnknownSync(BenchmarkConfigSchema)(
    await configResponse.json(),
  );

  ort.env.wasm.wasmPaths = {
    wasm: new URL(config.runtimeUrl, globalThis.location.href).href,
  };

  writeStatus("Requesting WebGPU device.");

  const { adapter, device } = await requestDevice();
  const preprocess = createPreprocessPipeline(device, config.inputSize);
  const io = createPersistentIo(device, config.inputSize);

  writeStatus("Loading rewritten General Lite model.");

  const modelStartedAt = performance.now();
  const modelResponse = await fetch(config.modelUrl, { cache: "no-store" });

  if (!modelResponse.ok) {
    throw new Error(`Model fetch failed with HTTP ${modelResponse.status}.`);
  }

  const model = new Uint8Array(await modelResponse.arrayBuffer());
  const modelMs = performance.now() - modelStartedAt;

  writeStatus(`Model loaded in ${modelMs.toFixed(1)} ms. Creating graph-capture session.`);

  ort.env.logLevel = "verbose";

  const sessionStartedAt = performance.now();
  let session: ort.InferenceSession;

  try {
    session = await ort.InferenceSession.create(model, {
      executionProviders: [{ name: "webgpu", device }],
      enableGraphCapture: true,
      graphOptimizationLevel: "basic",
      preferredOutputLocation: "gpu-buffer",
      logSeverityLevel: 0,
      logVerbosityLevel: 1,
    });
  } catch (captureError) {
    writeStatus(
      "Graph-capture session failed. Creating a no-capture diagnostic session for node placement.",
    );

    try {
      const diagnosticSession = await ort.InferenceSession.create(model, {
        executionProviders: [{ name: "webgpu", device }],
        enableGraphCapture: false,
        graphOptimizationLevel: "basic",
        preferredOutputLocation: "gpu-buffer",
        logSeverityLevel: 0,
        logVerbosityLevel: 1,
      });

      diagnosticSessionCreated = true;

      await diagnosticSession.release();
    } catch (diagnosticError) {
      const parsedDiagnosticError =
        diagnosticError instanceof Error
          ? diagnosticError
          : new Error(String(diagnosticError));

      diagnosticSessionError =
        `${parsedDiagnosticError.message}\n${parsedDiagnosticError.stack ?? ""}`;

      captureDiagnosticLog(
        "diagnostic-session-error",
        [diagnosticSessionError],
      );
    }

    throw captureError;
  }

  const sessionMs = performance.now() - sessionStartedAt;
  const reports: CaseReport[] = [];

  writeStatus(`Session created in ${sessionMs.toFixed(1)} ms.`);

  try {
    for (let caseIndex = 0; caseIndex < config.cases.length; caseIndex += 1) {
      const benchmarkCase = config.cases[caseIndex];

      writeStatus(`Running ${benchmarkCase.id}.`);

      const inputResponse = await fetch(benchmarkCase.inputUrl, {
        cache: "no-store",
      });

      if (!inputResponse.ok) {
        throw new Error(
          `Input ${benchmarkCase.id} failed with HTTP ${inputResponse.status}.`,
        );
      }

      const source = await inputResponse.blob();

      const first = await runRemoval(
        device,
        session,
        source,
        preprocess,
        io,
        config.inputSize,
      );

      await uploadOutput(caseIndex, first.blob);

      const warmRuns: RunTimings[] = [];

      for (let run = 0; run < config.warmRepeats; run += 1) {
        const warm = await runRemoval(
          device,
          session,
          source,
          preprocess,
          io,
          config.inputSize,
        );

        warmRuns.push(warm.timings);
      }

      const warmMedian = medianTimings(warmRuns);

      reports.push({
        id: benchmarkCase.id,
        firstRun: first.timings,
        warmRuns,
        warmMedian,
      });

      writeStatus(
        `${benchmarkCase.id}: warm median ${warmMedian.totalMs.toFixed(1)} ms.`,
      );
    }
  } finally {
    io.inputTensor.dispose();
    io.outputTensor.dispose();
    io.inputBuffer.destroy();
    io.outputBuffer.destroy();
    await session.release();
  }

  const report = {
    schemaVersion: 1,
    tool: "bgcut-browser-model-candidate",
    generatedAt: new Date().toISOString(),
    runtime: {
      userAgent: navigator.userAgent,
      adapterInfo: adapter.info,
      limits: {
        maxStorageBuffersPerShaderStage:
          adapter.limits.maxStorageBuffersPerShaderStage,
        maxStorageBufferBindingSize:
          adapter.limits.maxStorageBufferBindingSize,
      },
    },
    modelMs,
    sessionMs,
    inputSize: config.inputSize,
    warmRepeats: config.warmRepeats,
    graphCapture: true,
    graphOptimizationLevel: "basic",
    diagnosticLogs,
    persistentGpuInput: true,
    persistentGpuOutput: true,
    cases: reports,
    timingSummary: {
      warmMedianAcrossCaseMediansMs: median(
        reports.map((report) => report.warmMedian.totalMs),
      ),
    },
  };

  const reportResponse = await fetch("/report", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(report),
  });

  const result = await reportResponse.text();

  if (!reportResponse.ok) {
    throw new Error(result);
  }

  writeStatus("");
  writeStatus("Benchmark complete.");
  writeStatus(result);
};

void main().catch((error) => {
  const parsedError =
    error instanceof Error
      ? error
      : new Error(String(error));

  const message = `${parsedError.message}\n${parsedError.stack ?? ""}`;

  writeStatus("");
  writeStatus("BENCHMARK FAILED");
  writeStatus(message);

  void fetch("/failure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message,
      diagnosticSessionCreated,
      diagnosticSessionError,
      logs: diagnosticLogs,
    }),
  });
});
