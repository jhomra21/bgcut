import { Data } from "effect";

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

export const formatImageError = (error: ImageError): string => {
  switch (error._tag) {
    case "UnsupportedImage":
      return `Unsupported image type: ${error.mimeType || "unknown"}`;
    case "ImageDecodeFailed":
      return `Could not decode ${error.fileName}.`;
    case "ImageProcessingFailed":
      return error.message;
  }
};

export const formatBackgroundRemovalError = (error: BackgroundRemovalError): string => {
  switch (error._tag) {
    case "UnsupportedImage":
    case "ImageDecodeFailed":
    case "ImageProcessingFailed":
      return formatImageError(error);
    default:
      return error.message;
  }
};
