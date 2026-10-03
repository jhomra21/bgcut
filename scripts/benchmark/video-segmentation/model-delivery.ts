export const EDGETAM_RELEASE =
  "edgetam-v1";

export const EDGETAM_RELEASE_BASE =
  `https://github.com/twinkling-reality/rotyl/releases/download/${EDGETAM_RELEASE}`;

export const EDGETAM_RELEASE_FILES = {
  "vision_encoder_fp16.onnx":
    167_617,
  "vision_encoder_fp16.onnx_data":
    9_739_536,
  "prompt_encoder_mask_decoder_fp16.onnx":
    229_799,
  "prompt_encoder_mask_decoder_fp16.onnx_data":
    10_454_016,
  "memory_attention_shared_fp16.onnx":
    12_049_526,
  "memory_encoder.onnx":
    6_691_119,
  "tracked_mask_decoder_fp16.onnx":
    11_013_652,
  "parameters.json":
    26_913,
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

const PROXY_PREFIX =
  `/video-model/${EDGETAM_RELEASE}/`;

export const edgeTamReleaseUrl = (
  filename:
    EdgeTamReleaseFile,
): string =>
  `${EDGETAM_RELEASE_BASE}/${filename}`;

export const browserVideoModelUrl = (
  sourceUrl: string,
): string => {
  if (
    sourceUrl.startsWith(
      `${EDGETAM_RELEASE_BASE}/`,
    )
  ) {
    const filename =
      sourceUrl.slice(
        EDGETAM_RELEASE_BASE.length +
          1,
      );

    if (
      isEdgeTamReleaseFile(
        filename,
      )
    ) {
      return `${PROXY_PREFIX}${filename}`;
    }
  }

  return sourceUrl;
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
