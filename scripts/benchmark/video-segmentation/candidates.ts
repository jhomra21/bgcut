import {
  edgeTamReleaseUrl,
} from "./model-delivery";

import type {
  VideoModelArtifact,
  VideoSegmentationCandidate,
  VideoSegmentationCandidateId,
} from "./types";

const edgeTamArtifacts = (): readonly VideoModelArtifact[] => [
  {
    role: "vision-encoder",
    filename:
      "vision_encoder_fp16.onnx",
    url:
      edgeTamReleaseUrl("vision_encoder_fp16.onnx"),
    reportedSizeMb:
      0.167617,
    externalData: [
      {
        filename:
          "vision_encoder_fp16.onnx_data",
        url:
          edgeTamReleaseUrl("vision_encoder_fp16.onnx_data"),
        reportedSizeMb:
          9.739536,
      },
    ],
  },
  {
    role: "mask-decoder",
    filename:
      "prompt_encoder_mask_decoder_fp16.onnx",
    url:
      edgeTamReleaseUrl("prompt_encoder_mask_decoder_fp16.onnx"),
    reportedSizeMb:
      0.229799,
    externalData: [
      {
        filename:
          "prompt_encoder_mask_decoder_fp16.onnx_data",
        url:
          edgeTamReleaseUrl("prompt_encoder_mask_decoder_fp16.onnx_data"),
        reportedSizeMb:
          10.454016,
      },
    ],
  },
  {
    role:
      "memory-attention",
    filename:
      "memory_attention_shared_fp16.onnx",
    url:
      edgeTamReleaseUrl("memory_attention_shared_fp16.onnx"),
    reportedSizeMb:
      12.049526,
  },
  {
    role:
      "memory-encoder",
    filename:
      "memory_encoder.onnx",
    url:
      edgeTamReleaseUrl("memory_encoder.onnx"),
    reportedSizeMb:
      6.691119,
  },
  {
    role:
      "tracked-mask-decoder",
    filename:
      "tracked_mask_decoder_fp16.onnx",
    url:
      edgeTamReleaseUrl("tracked_mask_decoder_fp16.onnx"),
    reportedSizeMb:
      11.013652,
  },
  {
    role:
      "parameters",
    filename:
      "parameters.json",
    url:
      edgeTamReleaseUrl("parameters.json"),
    reportedSizeMb:
      0.026913,
  },
];

const sam21TinyArtifacts = (): readonly VideoModelArtifact[] => {
  const base =
    "https://huggingface.co/diffusionstudio/sam2.1-tiny-video-onnx-fp16/resolve/66673b5db39371b7dd7847f4d3bc0d4f4179b79e";

  return [
    {
      role: "vision-encoder",
      filename: "vision_encoder.onnx",
      url: `${base}/onnx/vision_encoder.onnx`,
      reportedSizeMb: 58.385353,
    },
    {
      role: "mask-decoder",
      filename: "mask_decoder.onnx",
      url: `${base}/onnx/mask_decoder.onnx`,
      reportedSizeMb: 8.898805,
    },
    {
      role: "memory-attention",
      filename: "memory_attention.onnx",
      url: `${base}/onnx/memory_attention.onnx`,
      reportedSizeMb: 13.02947,
    },
    {
      role: "memory-encoder",
      filename: "memory_encoder.onnx",
      url: `${base}/onnx/memory_encoder.onnx`,
      reportedSizeMb: 2.807753,
    },
    {
      role: "pointer-tpos",
      filename: "pointer_tpos.onnx",
      url: `${base}/onnx/pointer_tpos.onnx`,
      reportedSizeMb: 0.034228,
    },
    {
      role: "constants",
      filename: "constants.json",
      url: `${base}/constants.json`,
      reportedSizeMb: 0.009781,
    },
  ];
};

export const VIDEO_SEGMENTATION_CANDIDATES = {
  "sam21-tiny": {
    id: "sam21-tiny",
    label: "SAM 2.1 Tiny 512 fp16",
    family: "SAM 2.1",
    inputSize: 512,
    license: "Apache-2.0",
    repository:
      "diffusionstudio/sam2.1-tiny-video-onnx-fp16@66673b5db39371b7dd7847f4d3bc0d4f4179b79e",
    baseModel: "facebook/sam2.1-hiera-tiny",
    artifacts: sam21TinyArtifacts(),
  },
  edgetam: {
    id: "edgetam",
    label: "EdgeTAM 1024 fp16",
    family: "EdgeTAM",
    inputSize: 1024,
    license: "Apache-2.0",
    repository:
      "twinkling-reality/rotyl release edgetam-v1@49c98e5909101775bac257210601715a03bb22d0",
    baseModel:
      "facebook/EdgeTAM",
    artifacts:
      edgeTamArtifacts(),
  },
} as const satisfies Readonly<Record<VideoSegmentationCandidateId, VideoSegmentationCandidate>>;

export const reportedModelSizeMb = (
  candidate: VideoSegmentationCandidate,
): number =>
  candidate.artifacts.reduce(
    (total, artifact) =>
      total +
      (artifact.reportedSizeMb ??
        0) +
      (
        artifact.externalData ??
        []
      ).reduce(
        (
          externalTotal,
          external,
        ) =>
          externalTotal +
          (external.reportedSizeMb ??
            0),
        0,
      ),
    0,
  );
