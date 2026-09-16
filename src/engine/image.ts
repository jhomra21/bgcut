import { Effect } from "effect";

import { ImageDecodeFailed, ImageProcessingFailed, UnsupportedImage, type ImageError } from "./errors";

export const MODEL_INPUT_SIZE = 512;
export const MODEL_PIXEL_COUNT = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const isSupportedImageType = (mimeType: string): boolean => supportedImageTypes.has(mimeType);

export type DecodedImage = {
  readonly width: number;
  readonly height: number;
};

export const loadImageBitmap = (file: File): Effect.Effect<ImageBitmap, ImageError> =>
  Effect.gen(function* () {
    if (!isSupportedImageType(file.type)) {
      return yield* new UnsupportedImage({ mimeType: file.type });
    }

    return yield* Effect.tryPromise({
      try: () => createImageBitmap(file, { imageOrientation: "from-image" }),
      catch: () => new ImageDecodeFailed({ fileName: file.name }),
    });
  });

export const decodeImage = (file: File): Effect.Effect<DecodedImage, ImageError> =>
  Effect.acquireUseRelease(
    loadImageBitmap(file),
    (bitmap) => Effect.succeed({ width: bitmap.width, height: bitmap.height }),
    (bitmap) => Effect.sync(() => bitmap.close()),
  );

export const prepareModelPixels = (
  bitmap: ImageBitmap,
): Effect.Effect<Uint8ClampedArray, ImageProcessingFailed> =>
  Effect.try({
    try: () => {
      const canvas = document.createElement("canvas");
      canvas.width = MODEL_INPUT_SIZE;
      canvas.height = MODEL_INPUT_SIZE;

      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (context === null) {
        throw new Error("2D canvas is unavailable.");
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

      return context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;
    },
    catch: () =>
      new ImageProcessingFailed({
        message: "The image could not be resized for background-removal inference.",
      }),
  });
