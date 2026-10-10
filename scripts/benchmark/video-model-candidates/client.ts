import * as ort from "onnxruntime-web/webgpu";

import { floatToHalf } from "./half";

import { VIDEO_SEGMENTATION_CANDIDATES } from "../video-segmentation/candidates";
import { openMediaBunnyVideoSource } from "../video-segmentation/media-source";
import { configureVideoOrt, frameToNchw } from "../video-segmentation/runtime-common";

const MODEL_URL = "/specialized/efficienttam-ti-image-encoder.onnx";

const MODEL_REVISION = "40788ab3b74e96ad7b5db2a809f654b9f99c142e";

const MODEL_SHA256 = "6d75656b6c2501819269ec76ecc18bf555695e91b67def84fb052f97dcbbb812";

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const left = sorted[Math.floor((sorted.length - 1) / 2)];
  const right = sorted[Math.floor(sorted.length / 2)];

  if (left === undefined || right === undefined) {
    throw new Error("Model candidate benchmark has no timings.");
  }

  return (left + right) / 2;
};

const inspectOutput = (outputs: Record<string, ort.Tensor>) =>
  Object.entries(outputs).map(([name, tensor]) => {
    const elements = tensor.dims.reduce((product, size) => product * size, 1);

    if (elements < 1 || tensor.dims.some((dim) => dim < 1)) {
      throw new Error(`Encoder returned an invalid ${name} tensor shape.`);
    }

    return { name, type: tensor.type, dims: tensor.dims, elements };
  });

const measure = async (
  label: string,
  session: ort.InferenceSession,
  inputName: string,
  tensor: ort.Tensor,
  outputNames?: readonly string[],
) => {
  const runs: number[] = [];
  let signatures: ReturnType<typeof inspectOutput> | undefined;

  for (let index = 0; index < 6; index += 1) {
    const started = performance.now();

    const outputs = outputNames === undefined
      ? await session.run({ [inputName]: tensor })
      : await session.run({ [inputName]: tensor }, [...outputNames]);

    const elapsed = performance.now() - started;

    try {
      const current = inspectOutput(outputs);

      if (signatures !== undefined && JSON.stringify(signatures) !== JSON.stringify(current)) {
        throw new Error(`${label} returned inconsistent output shapes.`);
      }

      signatures = current;

      if (index > 0) runs.push(elapsed);
    } finally {
      for (const output of Object.values(outputs)) output.dispose();
    }
  }

  return {
    model: label,
    warmupRuns: 1,
    measuredRuns: runs.length,
    medianInferenceMs: median(runs),
    timingsMs: runs,
    outputs: signatures,
  };
};

type ProbeCase =
  | (Awaited<ReturnType<typeof measure>> & { readonly loadMs: number })
  | { readonly model: string; readonly unsupported: true; readonly reason: string };

const main = async () => {
  configureVideoOrt();

  const fixtureResponse = await fetch("/quality/bear.mp4");

  if (!fixtureResponse.ok) {
    throw new Error(`Could not fetch bear fixture: HTTP ${fixtureResponse.status}.`);
  }

  const file = new File([await fixtureResponse.blob()], "bear.mp4", { type: "video/mp4" });
  const source = await openMediaBunnyVideoSource(file);
  let etamSession: ort.InferenceSession | undefined;
  let samSession: ort.InferenceSession | undefined;

  try {
    const frame = await source.frameAt(source.info.firstTimestamp);

    if (frame === null) throw new Error("Bear fixture cannot decode the first frame.");

    let normalized: Float32Array;

    try {
      normalized = frameToNchw(
        frame.frame,
        512,
        [0.485, 0.456, 0.406],
        [0.229, 0.224, 0.225],
      );
    } finally {
      frame.close();
    }

    const half = floatToHalf(normalized);

    const candidates: ProbeCase[] = [];

    const result = {
      name: "efficienttam-ti-512-encoder-probe",
      clip: "bear",
      modelRevision: MODEL_REVISION,
      modelSha256: MODEL_SHA256,
      fairComparison: "encoder only; model architectures and tensor dtypes differ; not a tracking or mask-quality result",
      candidates,
    };

    const candidateResponse = await fetch(MODEL_URL);

    if (!candidateResponse.ok) {
      throw new Error(`Pinned EfficientTAM encoder missing: HTTP ${candidateResponse.status}.`);
    }

    try {
      const started = performance.now();
      etamSession = await ort.InferenceSession.create(
        new Uint8Array(await candidateResponse.arrayBuffer()),
        { executionProviders: [{ name: "webgpu" }], graphOptimizationLevel: "all" },
      );
      const loadMs = performance.now() - started;

      if (etamSession.inputNames.length !== 1 ||
          etamSession.inputNames[0] !== "image") {
        throw new Error(`Unexpected EfficientTAM inputs: ${etamSession.inputNames.join(", ")}.`);
      }

      const input = new ort.Tensor("float16", half, [1, 3, 512, 512]);

      try {
        const measurements = await measure(
          "EfficientTAM-Ti 512 FP16",
          etamSession,
          "image",
          input,
        );

        result.candidates.push({ ...measurements, loadMs });
      } finally {
        input.dispose();
      }
    } catch (error) {
      result.candidates.push({
        model: "EfficientTAM-Ti 512 FP16",
        unsupported: true,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    const samArtifact = VIDEO_SEGMENTATION_CANDIDATES["sam21-tiny"]
      .artifacts.find((artifact) => artifact.role === "vision-encoder");

    if (samArtifact === undefined) {
      throw new Error("SAM reference encoder artifact is missing.");
    }

    const samResponse = await fetch(samArtifact.url);

    if (!samResponse.ok) {
      throw new Error(`Could not download SAM reference encoder: HTTP ${samResponse.status}.`);
    }

    const samStarted = performance.now();
    samSession = await ort.InferenceSession.create(
      new Uint8Array(await samResponse.arrayBuffer()),
      { executionProviders: [{ name: "webgpu" }], graphOptimizationLevel: "all" },
    );
    const samLoadMs = performance.now() - samStarted;
    const samInput = new ort.Tensor("float32", normalized, [1, 3, 512, 512]);

    try {
      const sample = await measure(
        "SAM 2.1 Tiny 512 FP32 input",
        samSession,
        "pixel_values",
        samInput,
        ["feats0", "feats1", "feats2"],
      );

      result.candidates.push({ ...sample, loadMs: samLoadMs });
    } finally {
      samInput.dispose();
    }

    const response = await fetch("/result", {
      method: "POST",
      body: JSON.stringify({ reports: [result] }),
    });

    if (!response.ok) {
      throw new Error(`Could not save encoder probe: HTTP ${response.status}.`);
    }
  } finally {
    source.close();
    await Promise.all([
      etamSession?.release().catch(() => undefined),
      samSession?.release().catch(() => undefined),
    ]);
  }
};

void main().catch((error) => fetch("/failure", {
  method: "POST",
  body: JSON.stringify({ message: String(error), stack: error instanceof Error ? error.stack : "" }),
}));
