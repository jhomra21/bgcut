import type {
  VideoSegmentationCandidate,
} from "./types";

const SAM21_FP32_REVISION =
  "3b2984dd865f6e9d2cc6aed0be6a5a5c2eb352ce";

const SAM21_FP32_BASE =
  `https://huggingface.co/square-zero-labs/sam2.1-tiny-video-onnx/resolve/${SAM21_FP32_REVISION}`;

export const SAM21_FP32_REFERENCE:
  VideoSegmentationCandidate = {
    id: "sam21-tiny",
    label:
      "SAM 2.1 Tiny 1024 fp32 reference",
    family: "SAM 2.1",
    inputSize: 1024,
    license: "Apache-2.0",
    repository:
      `square-zero-labs/sam2.1-tiny-video-onnx@${SAM21_FP32_REVISION}`,
    baseModel:
      "facebook/sam2.1-hiera-tiny",
    artifacts: [
      {
        role:
          "vision-encoder",
        filename:
          "vision_encoder.onnx",
        url:
          `${SAM21_FP32_BASE}/onnx/vision_encoder.onnx`,
        reportedSizeMb:
          134.335567,
      },
      {
        role:
          "mask-decoder",
        filename:
          "mask_decoder.onnx",
        url:
          `${SAM21_FP32_BASE}/onnx/mask_decoder.onnx`,
        reportedSizeMb:
          17.794355,
      },
      {
        role:
          "memory-encoder",
        filename:
          "memory_encoder.onnx",
        url:
          `${SAM21_FP32_BASE}/onnx/memory_encoder.onnx`,
        reportedSizeMb:
          5.616496,
      },
      {
        role:
          "memory-attention",
        filename:
          "memory_attention.onnx",
        url:
          `${SAM21_FP32_BASE}/onnx/memory_attention.onnx`,
        reportedSizeMb:
          32.259165,
      },
      {
        role:
          "pointer-tpos",
        filename:
          "pointer_tpos.onnx",
        url:
          `${SAM21_FP32_BASE}/onnx/pointer_tpos.onnx`,
        reportedSizeMb:
          0.067289,
      },
      {
        role:
          "constants",
        filename:
          "constants.json",
        url:
          `${SAM21_FP32_BASE}/constants.json`,
        reportedSizeMb:
          0.009922,
      },
    ],
  };
