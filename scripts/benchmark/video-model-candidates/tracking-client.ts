import * as ort from "onnxruntime-web/webgpu";

import { channelsToHalfTokens, floatToHalf, halfToFloat } from "./half";

import { openMediaBunnyVideoSource } from "../video-segmentation/media-source";
import { binaryMaskIou, davisBoundaryF } from "../video-segmentation/quality-metrics";
import { configureVideoOrt, frameToNchw } from "../video-segmentation/runtime-common";

const SIDE = 512;

const FEATURE_SIDE = 32;

const TOKENS = FEATURE_SIDE * FEATURE_SIDE;

const CHANNELS = 64;

const POINTER_CHANNELS = 256;

const MAX_MEMORY_FRAMES = 7;

const roles = [
  "image_encoder",
  "prompt_encoder",
  "mask_decoder",
  "memory_encoder",
  "memory_attention",
] as const;

type Role = (typeof roles)[number];

type Memory = {
  readonly index: number;
  readonly features: Uint16Array;
  readonly positions: Uint16Array;
  readonly pointer: Uint16Array;
};

const halfTensor = (data: Uint16Array, dims: readonly number[]) =>
  new ort.Tensor("float16", data, [...dims]);

const requireHalf = (outputs: Record<string, ort.Tensor>, name: string): Uint16Array => {
  const value = outputs[name];

  if (value?.type !== "float16" || !(value.data instanceof Uint16Array)) {
    throw new Error(`EfficientTAM ${name} must be a CPU-readable float16 tensor.`);
  }

  return value.data;
};

const toHalf = (tensor: ort.Tensor, name: string): ort.Tensor => {
  if (tensor.type === "float16") return tensor;

  if (tensor.type !== "float32" || !(tensor.data instanceof Float32Array)) {
    throw new Error(`EfficientTAM ${name} cannot be converted to Float16 from ${tensor.type}.`);
  }

  // The published prompt encoder exposes float32 embeddings, while the
  // mask decoder accepts float16. Convert only this model-boundary tensor.
  return halfTensor(floatToHalf(tensor.data), tensor.dims);
};

const requireDims = (tensor: ort.Tensor | undefined, name: string, dims: readonly number[]) => {
  if (tensor === undefined || tensor.dims.length !== dims.length ||
      tensor.dims.some((value, index) => value !== dims[index])) {
    throw new Error(`EfficientTAM ${name} has unexpected dimensions: ${tensor?.dims.join(",") ?? "missing"}.`);
  }

  return tensor;
};

const dispose = (outputs: Record<string, ort.Tensor>) => {
  for (const tensor of Object.values(outputs)) tensor.dispose();
};

const readTemporalPosition = async (): Promise<Uint16Array> => {
  const response = await fetch("/specialized/efficienttam-ti-maskmem-tpos.npy");

  if (!response.ok) throw new Error(`EfficientTAM temporal embeddings: HTTP ${response.status}.`);

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.length !== 1024 || bytes[0] !== 0x93 ||
      new TextDecoder().decode(bytes.slice(1, 6)) !== "NUMPY" ||
      bytes[6] !== 1 || bytes[7] !== 0) {
    throw new Error("Unexpected EfficientTAM NPY temporal embedding format.");
  }

  const headerBytes = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  const text = new TextDecoder().decode(bytes.slice(10, 10 + headerBytes));

  if (!text.includes("'<f2'") || !text.includes("(7, 1, 1, 64)")) {
    throw new Error(`Unexpected temporal embeddings dtype/shape: ${text.trim()}.`);
  }

  const start = 10 + headerBytes;

  if (bytes.length - start !== MAX_MEMORY_FRAMES * CHANNELS * 2) {
    throw new Error("Temporal embeddings contain an unexpected number of values.");
  }

  return new Uint16Array(bytes.buffer.slice(start));
};

const withTemporalPosition = (
  position: Uint16Array,
  encodings: Uint16Array,
  slot: number,
) => {
  const tokens = channelsToHalfTokens(position, CHANNELS, TOKENS);
  const temporal = new Float32Array(tokens.length);

  for (let index = 0; index < tokens.length; index += 1) {
    const positionHalf = tokens[index] ?? 0;
    const temporalHalf = encodings[slot * CHANNELS + (index % CHANNELS)] ?? 0;
    temporal[index] = halfToFloat(positionHalf) + halfToFloat(temporalHalf);
  }

  return floatToHalf(temporal);
};

const assembledMemory = (bank: readonly Memory[], frameIndex: number, temporal: Uint16Array) => {
  const selected = bank.slice(-MAX_MEMORY_FRAMES);
  const features = new Uint16Array(selected.length * CHANNELS * TOKENS);
  const positions = new Uint16Array(features.length);
  const pointers = new Uint16Array(selected.length * POINTER_CHANNELS);

  for (const [index, value] of selected.entries()) {
    features.set(
      channelsToHalfTokens(value.features, CHANNELS, TOKENS),
      index * CHANNELS * TOKENS,
    );

    // The final temporal slot corresponds to the closest conditioning frame.
    const slot = Math.max(0, Math.min(
      MAX_MEMORY_FRAMES - 1,
      MAX_MEMORY_FRAMES - (frameIndex - value.index),
    ));

    positions.set(
      withTemporalPosition(value.positions, temporal, slot),
      index * CHANNELS * TOKENS,
    );
    pointers.set(value.pointer, index * POINTER_CHANNELS);
  }

  return {
    features: halfTensor(features, [selected.length * TOKENS, 1, CHANNELS]),
    positions: halfTensor(positions, [selected.length * TOKENS, 1, CHANNELS]),
    pointers: halfTensor(pointers, [selected.length * 4, 1, CHANNELS]),
  };
};

const promptInputs = (x?: number, y?: number) => ({
  point_coords: new ort.Tensor(
    "float32",
    Float32Array.of(x === undefined ? 0 : x * SIDE, y === undefined ? 0 : y * SIDE, 0, 0),
    [1, 2, 2],
  ),
  point_labels: new ort.Tensor(
    "int32",
    Int32Array.of(x === undefined ? -1 : 1, -1),
    [1, 2],
  ),
  mask_input: new ort.Tensor("float32", new Float32Array(128 * 128), [1, 1, 128, 128]),
  has_mask: new ort.Tensor("float32", Float32Array.of(0), [1]),
});

const selectMask = (outputs: Record<string, ort.Tensor>) => {
  const masksTensor = outputs.masks;
  const iouTensor = outputs.iou_pred;
  const ptrTensor = outputs.obj_ptrs;

  if (masksTensor?.type !== "float16" || ptrTensor?.type !== "float16" ||
      iouTensor?.type !== "float16") {
    throw new Error("EfficientTAM decoder returned unexpected mask, score, or pointer dtype.");
  }

  const masks = requireHalf(outputs, "masks");
  const scores = requireHalf(outputs, "iou_pred");
  const pointers = requireHalf(outputs, "obj_ptrs");
  const count = scores.length;

  requireDims(masksTensor, "masks", [1, count, SIDE, SIDE]);
  requireDims(ptrTensor, "obj_ptrs", [1, count, POINTER_CHANNELS]);

  if (count < 1 || count > 4) {
    throw new Error(`Unexpected EfficientTAM mask proposal count: ${count}.`);
  }

  let winner = 0;

  for (let index = 1; index < count; index += 1) {
    if (halfToFloat(scores[index] ?? 0) > halfToFloat(scores[winner] ?? 0)) {
      winner = index;
    }
  }

  const score = halfToFloat(scores[winner] ?? 0);

  if (!Number.isFinite(score)) {
    throw new Error("EfficientTAM produced a non-finite mask confidence score.");
  }

  const mask = masks.slice(winner * SIDE * SIDE, (winner + 1) * SIDE * SIDE);
  const pointer = pointers.slice(winner * POINTER_CHANNELS, (winner + 1) * POINTER_CHANNELS);

  return { mask, pointer, score, winner, proposals: count };
};

type Truth = { readonly mask: Uint8Array; readonly width: number; readonly height: number };

const loadTruth = async (clip: string, index: number): Promise<Truth> => {
  const response = await fetch(`/quality/${clip}/${String(index).padStart(5, "0")}.png`);

  if (!response.ok) {
    throw new Error(`Missing DAVIS truth mask for ${clip} frame ${index}.`);
  }

  const bitmap = await createImageBitmap(await response.blob());

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (context === null) throw new Error("Cannot decode DAVIS mask canvas.");

    context.drawImage(bitmap, 0, 0);

    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const mask = new Uint8Array(bitmap.width * bitmap.height);

    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      mask[pixel] = (pixels[pixel * 4] ?? 0) > 0 ? 1 : 0;
    }

    return { mask, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
};

const binaryMask = (prediction: Uint16Array, truth: Truth) => {
  const mask = new Uint8Array(truth.mask.length);

  for (let y = 0; y < truth.height; y += 1) {
    const sy = Math.min(SIDE - 1, Math.floor((y + 0.5) * SIDE / truth.height));

    for (let x = 0; x < truth.width; x += 1) {
      const sx = Math.min(SIDE - 1, Math.floor((x + 0.5) * SIDE / truth.width));
      const value = prediction[sy * SIDE + sx] ?? 0;

      mask[y * truth.width + x] = value !== 0 && (value & 0x8000) === 0 ? 1 : 0;
    }
  }

  return mask;
};

const frameInput = (frame: VideoFrame) => halfTensor(
  floatToHalf(
    frameToNchw(frame, SIDE, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
  ),
  [1, 3, SIDE, SIDE],
);

const main = async () => {
  configureVideoOrt();

  const sessions = new Map<Role, ort.InferenceSession>();
  const loading = [];
  const started = performance.now();

  const fileResponse = await fetch("/quality/bear.mp4");

  if (!fileResponse.ok) throw new Error("The DAVIS bear fixture is unavailable.");

  const file = new File([await fileResponse.blob()], "bear.mp4", { type: "video/mp4" });
  const source = await openMediaBunnyVideoSource(file);
  const temporal = await readTemporalPosition();

  try {
    for (const role of roles) {
      const response = await fetch(`/specialized/efficienttam-ti-${role}.onnx`);

      if (!response.ok) throw new Error(`Missing EfficientTAM ${role}: HTTP ${response.status}.`);

      const model = new Uint8Array(await response.arrayBuffer());
      const loadStarted = performance.now();

      const session = await ort.InferenceSession.create(model, {
        executionProviders: [{ name: "webgpu" }],
        graphOptimizationLevel: "all",
      });

      sessions.set(role, session);
      loading.push({
        role,
        bytes: model.byteLength,
        loadMs: performance.now() - loadStarted,
        inputs: session.inputNames,
        outputs: session.outputNames,
      });
    }

    const get = (role: Role) => {
      const session = sessions.get(role);

      if (session === undefined) throw new Error(`EfficientTAM ${role} session unavailable.`);

      return session;
    };

    const clickInputs = promptInputs(0.4, 0.65);
    const trackInputs = promptInputs();
    const clickEmbedding = await get("prompt_encoder").run(clickInputs);
    const noPointEmbedding = await get("prompt_encoder").run(trackInputs);

    const times = (await source.frameTimes(
      source.info.firstTimestamp,
      source.info.firstTimestamp + Math.min(0.5, source.info.duration),
      24,
    )).slice(0, 8);

    if (times.length < 2) throw new Error("EfficientTAM tracking needs at least two DAVIS frames.");

    const bank: Memory[] = [];
    const results = [];

    for (const [index, timestamp] of times.entries()) {
      const frame = await source.frameAt(timestamp);

      if (frame === null) throw new Error(`Could not decode EfficientTAM frame ${index}.`);

      const frameStarted = performance.now();

      try {
        const input = frameInput(frame.frame);

        try {
          const vision = await get("image_encoder").run({ image: input });

          try {
            const raw = vision.vision_features;
            const position = vision.vision_pos_enc;

            requireDims(raw, "vision_features", [1, 256, FEATURE_SIDE, FEATURE_SIDE]);
            requireDims(position, "vision_pos_enc", [1, 256, FEATURE_SIDE, FEATURE_SIDE]);

            let conditioned: ort.Tensor | undefined;
            let ownedMemory: ReturnType<typeof assembledMemory> | undefined;

            if (index > 0) {
              ownedMemory = assembledMemory(bank, index, temporal);

              const attended = await get("memory_attention").run({
                curr: raw,
                curr_pos: position,
                spatial_memory: ownedMemory.features,
                spatial_memory_pos: ownedMemory.positions,
                obj_ptr: ownedMemory.pointers,
              });

              conditioned = requireDims(
                attended.output,
                "memory_attention.output",
                [1, 256, FEATURE_SIDE, FEATURE_SIDE],
              );
            }

            const prompt = index === 0 ? clickEmbedding : noPointEmbedding;

            const sparseSource = requireDims(
              prompt.sparse_prompt_embeddings,
              "sparse_prompt_embeddings",
              [1, 3, 256],
            );

            const denseSource = requireDims(
              prompt.dense_prompt_embeddings,
              "dense_prompt_embeddings",
              [1, 256, FEATURE_SIDE, FEATURE_SIDE],
            );

            const sparse = toHalf(sparseSource, "sparse_prompt_embeddings");
            const dense = toHalf(denseSource, "dense_prompt_embeddings");
            let decoded: Record<string, ort.Tensor>;

            try {
              decoded = await get("mask_decoder").run({
                image_embeddings: conditioned ?? raw,
                sparse_prompt_embeddings: sparse,
                dense_prompt_embeddings: dense,
              });
            } finally {
              if (sparse !== sparseSource) sparse.dispose();

              if (dense !== denseSource) dense.dispose();
            }

            try {
              const selected = selectMask(decoded);
              const maskInput = halfTensor(selected.mask, [1, 1, SIDE, SIDE]);
              let encoded: Record<string, ort.Tensor>;

              try {
                encoded = await get("memory_encoder").run({
                  pix_feat: raw,
                  masks: maskInput,
                });
              } finally {
                maskInput.dispose();
              }

              try {
                requireDims(encoded.vision_features, "memory.vision_features", [1, CHANNELS, FEATURE_SIDE, FEATURE_SIDE]);
                requireDims(encoded.vision_pos_enc, "memory.vision_pos_enc", [1, CHANNELS, FEATURE_SIDE, FEATURE_SIDE]);

                bank.push({
                  index,
                  features: requireHalf(encoded, "vision_features").slice(),
                  positions: requireHalf(encoded, "vision_pos_enc").slice(),
                  pointer: selected.pointer,
                });
              } finally {
                dispose(encoded);
              }

              // DAVIS PNG fetching and mask scoring are outside the inference
              // interval. They must not inflate the measured model latency.
              const inferenceMs = performance.now() - frameStarted;
              const truth = await loadTruth("bear", index);
              const binary = binaryMask(selected.mask, truth);
              const foreground = binary.reduce((total, value) => total + value, 0);

              results.push({
                index,
                timestamp,
                inferenceMs,
                proposals: selected.proposals,
                chosenProposal: selected.winner,
                score: selected.score,
                foreground,
                iou: binaryMaskIou(binary, truth.mask),
                boundaryF: davisBoundaryF(binary, truth.mask, truth.width, truth.height),
              });
            } finally {
              dispose(decoded);
              conditioned?.dispose();
              ownedMemory?.features.dispose();
              ownedMemory?.positions.dispose();
              ownedMemory?.pointers.dispose();
            }
          } finally {
            dispose(vision);
          }
        } finally {
          input.dispose();
        }
      } finally {
        frame.close();
      }
    }

    const tracked = results.slice(1);
    const trackedMs = tracked.reduce((sum, value) => sum + value.inferenceMs, 0);

    const report = {
      name: "efficienttam-ti-fp16-temporal-smoke",
      model: "egordm/efficienttam-ti-512@40788ab3",
      status: "experimental; single-object forward tracking; model comparison only",
      loading,
      frames: results,
      meanTrackedIou: tracked.reduce((sum, value) => sum + value.iou, 0) / tracked.length,
      meanTrackedBoundaryF: tracked.reduce((sum, value) => sum + value.boundaryF, 0) / tracked.length,
      trackedFps: 1000 * tracked.length / trackedMs,
      totalMs: performance.now() - started,
    };

    const response = await fetch("/result", {
      method: "POST",
      body: JSON.stringify({ reports: [report] }),
    });

    if (!response.ok) throw new Error(`Could not save EfficientTAM tracking results: HTTP ${response.status}.`);

    dispose(clickEmbedding);
    dispose(noPointEmbedding);

    for (const input of Object.values(clickInputs)) input.dispose();

    for (const input of Object.values(trackInputs)) input.dispose();
  } finally {
    source.close();
    await Promise.all([...sessions.values()].map((session) => session.release().catch(() => undefined)));
  }
};

void main().catch((error) => fetch("/failure", {
  method: "POST",
  body: JSON.stringify({ message: String(error), stack: error instanceof Error ? error.stack : "" }),
}));
