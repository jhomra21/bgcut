import type {
  VideoModelArtifact,
  VideoSegmentationCandidate,
  VideoSegmentationCandidateId,
} from "./types";

const modelArtifacts = (
  repository: string,
  sizes: Readonly<Record<Exclude<VideoModelArtifact["role"], "constants">, number>>,
): readonly VideoModelArtifact[] => {
  const base = `https://huggingface.co/${repository}/resolve/main`;

  return [
    {
      role: "vision-encoder",
      filename: "vision_encoder.onnx",
      url: `${base}/vision_encoder.onnx`,
      reportedSizeMb: sizes["vision-encoder"],
    },
    {
      role: "mask-decoder",
      filename: "mask_decoder.onnx",
      url: `${base}/mask_decoder.onnx`,
      reportedSizeMb: sizes["mask-decoder"],
    },
    {
      role: "memory-attention",
      filename: "memory_attention.onnx",
      url: `${base}/memory_attention.onnx`,
      reportedSizeMb: sizes["memory-attention"],
    },
    {
      role: "memory-encoder",
      filename: "memory_encoder.onnx",
      url: `${base}/memory_encoder.onnx`,
      reportedSizeMb: sizes["memory-encoder"],
    },
    {
      role: "constants",
      filename: "constants.json",
      url: `${base}/constants.json`,
    },
  ];
};

export const VIDEO_SEGMENTATION_CANDIDATES = {
  "sam21-tiny": {
    id: "sam21-tiny",
    label: "SAM 2.1 Tiny",
    family: "SAM 2.1",
    inputSize: 1024,
    license: "Apache-2.0",
    repository: "jax-image-tools/sam21-tiny-video-onnx",
    baseModel: "facebook/sam2.1-hiera-tiny",
    artifacts: modelArtifacts(
      "jax-image-tools/sam21-tiny-video-onnx",
      {
        "vision-encoder": 104.4,
        "mask-decoder": 17.0,
        "memory-attention": 30.9,
        "memory-encoder": 5.3,
      },
    ),
  },
  edgetam: {
    id: "edgetam",
    label: "EdgeTAM",
    family: "EdgeTAM",
    inputSize: 1024,
    license: "Apache-2.0",
    repository: "jax-image-tools/edgetam-video-onnx",
    baseModel: "facebook/EdgeTAM",
    artifacts: modelArtifacts(
      "jax-image-tools/edgetam-video-onnx",
      {
        "vision-encoder": 18.9,
        "mask-decoder": 17.0,
        "memory-attention": 19.9,
        "memory-encoder": 6.4,
      },
    ),
  },
} as const satisfies Readonly<Record<VideoSegmentationCandidateId, VideoSegmentationCandidate>>;

export const reportedModelSizeMb = (
  candidate: VideoSegmentationCandidate,
): number =>
  candidate.artifacts.reduce(
    (total, artifact) => total + (artifact.reportedSizeMb ?? 0),
    0,
  );
