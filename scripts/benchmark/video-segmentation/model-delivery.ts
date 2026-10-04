export const EDGETAM_RELEASE =
  "edgetam-v1";

export const EDGETAM_RELEASE_BASE =
  `https://github.com/twinkling-reality/rotyl/releases/download/${EDGETAM_RELEASE}`;

export const EDGETAM_RELEASE_FILES = {
  "vision_encoder_fp16.onnx": {
    asset:
      "vision_encoder_fp16.onnx.gz",
    rawBytes:
      167_617,
  },
  "vision_encoder_fp16.onnx_data": {
    asset:
      "vision_encoder_fp16.onnx_data.gz",
    rawBytes:
      9_739_536,
  },
  "prompt_encoder_mask_decoder_fp16.onnx": {
    asset:
      "prompt_encoder_mask_decoder_fp16.onnx.gz",
    rawBytes:
      229_799,
  },
  "prompt_encoder_mask_decoder_fp16.onnx_data": {
    asset:
      "prompt_encoder_mask_decoder_fp16.onnx_data.gz",
    rawBytes:
      10_454_016,
  },
  "memory_attention_shared_fp16.onnx": {
    asset:
      "memory_attention_shared_fp16.onnx.gz",
    rawBytes:
      12_049_526,
  },
  "memory_encoder.onnx": {
    asset:
      "memory_encoder.onnx.gz",
    rawBytes:
      6_691_119,
  },
  "tracked_mask_decoder_fp16.onnx": {
    asset:
      "tracked_mask_decoder_fp16.onnx.gz",
    rawBytes:
      11_013_652,
  },
  "parameters.json": {
    asset:
      "parameters.json.gz",
    rawBytes:
      26_913,
  },
} as const;

export type EdgeTamReleaseFile =
  keyof typeof EDGETAM_RELEASE_FILES;

const isEdgeTamReleaseFile = (
  filename: string,
): filename is EdgeTamReleaseFile =>
  Object.hasOwn(
    EDGETAM_RELEASE_FILES,
    filename,
  );

const sourceFilename = (
  sourceUrl: string,
): EdgeTamReleaseFile | null => {
  for (
    const [
      filename,
      file,
    ] of Object.entries(
      EDGETAM_RELEASE_FILES,
    )
  ) {
    if (
      sourceUrl ===
      `${EDGETAM_RELEASE_BASE}/${file.asset}`
    ) {
      // SAFETY: Object.entries() is iterating the statically typed EDGETAM_RELEASE_FILES object.
      return filename as EdgeTamReleaseFile;
    }
  }

  return null;
};

const PROXY_PREFIX =
  `/video-model/${EDGETAM_RELEASE}/`;

export const edgeTamReleaseUrl = (
  filename:
    EdgeTamReleaseFile,
): string =>
  `${EDGETAM_RELEASE_BASE}/${EDGETAM_RELEASE_FILES[filename].asset}`;

export const browserVideoModelUrl = (
  sourceUrl: string,
): string => {
  const filename =
    sourceFilename(
      sourceUrl,
    );

  return filename ===
    null
    ? sourceUrl
    : `${PROXY_PREFIX}${filename}`;
};

export const edgeTamProxyFilename = (
  pathname: string,
): EdgeTamReleaseFile | null => {
  if (
    !pathname.startsWith(
      PROXY_PREFIX,
    )
  ) {
    return null;
  }

  const filename =
    pathname.slice(
      PROXY_PREFIX.length,
    );

  return isEdgeTamReleaseFile(
    filename,
  )
    ? filename
    : null;
};
