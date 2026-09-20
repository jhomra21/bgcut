import { Data, Match } from "effect";

export class WebGpuUnavailable extends Data.TaggedError("WebGpuUnavailable")<{
  readonly message: string;
}> {}

export class AdapterUnavailable extends Data.TaggedError("AdapterUnavailable")<{
  readonly message: string;
}> {}

export class DeviceRequestFailed extends Data.TaggedError("DeviceRequestFailed")<{
  readonly message: string;
}> {}

export class RuntimeInitializationFailed extends Data.TaggedError("RuntimeInitializationFailed")<{
  readonly message: string;
}> {}

export class UnsupportedImage extends Data.TaggedError("UnsupportedImage")<{
  readonly mimeType: string;
}> {}

export class ImageDecodeFailed extends Data.TaggedError("ImageDecodeFailed")<{
  readonly fileName: string;
}> {}

export class ImageProcessingFailed extends Data.TaggedError("ImageProcessingFailed")<{
  readonly message: string;
}> {}

export class ModelDownloadFailed extends Data.TaggedError("ModelDownloadFailed")<{
  readonly message: string;
}> {}

export class ModelLoadFailed extends Data.TaggedError("ModelLoadFailed")<{
  readonly message: string;
}> {}

export class InferenceFailed extends Data.TaggedError("InferenceFailed")<{
  readonly message: string;
}> {}

export class ExportFailed extends Data.TaggedError("ExportFailed")<{
  readonly message: string;
}> {}

export type GpuRuntimeError =
  | WebGpuUnavailable
  | AdapterUnavailable
  | DeviceRequestFailed
  | RuntimeInitializationFailed;

export type ImageError = UnsupportedImage | ImageDecodeFailed | ImageProcessingFailed;

export type BackgroundRemovalError =
  | GpuRuntimeError
  | ImageError
  | ModelDownloadFailed
  | ModelLoadFailed
  | InferenceFailed
  | ExportFailed;

export const formatGpuRuntimeError = (error: GpuRuntimeError): string => error.message;

export const formatImageError = (error: ImageError): string =>
  Match.value(error).pipe(
    Match.tag("UnsupportedImage", (unsupported) =>
      `Unsupported image type: ${unsupported.mimeType || "unknown"}`
    ),
    Match.tag("ImageDecodeFailed", (decodeFailure) => `Could not decode ${decodeFailure.fileName}.`),
    Match.tag("ImageProcessingFailed", (processingFailure) => processingFailure.message),
    Match.exhaustive,
  );

export const formatBackgroundRemovalError = (error: BackgroundRemovalError): string =>
  Match.value(error).pipe(
    Match.tag(
      "UnsupportedImage",
      "ImageDecodeFailed",
      "ImageProcessingFailed",
      (imageError) => formatImageError(imageError),
    ),
    Match.tag(
      "WebGpuUnavailable",
      "AdapterUnavailable",
      "DeviceRequestFailed",
      "RuntimeInitializationFailed",
      "ModelDownloadFailed",
      "ModelLoadFailed",
      "InferenceFailed",
      "ExportFailed",
      (failure) => failure.message,
    ),
    Match.exhaustive,
  );
