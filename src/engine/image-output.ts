import { Effect } from "effect";

import { ExportFailed, ImageProcessingFailed } from "./errors";
import { MODEL_INPUT_SIZE } from "./image";
import { logitToAlphaByte } from "./matte";

export const createMatteCanvas = (
  logits: Float32Array,
): Effect.Effect<HTMLCanvasElement, ImageProcessingFailed> =>
  Effect.try({
    try: () => {
      const canvas = document.createElement("canvas");
      canvas.width = MODEL_INPUT_SIZE;
      canvas.height = MODEL_INPUT_SIZE;

      const context = canvas.getContext("2d");

      if (context === null) {
        throw new Error("2D canvas is unavailable.");
      }

      const matte = context.createImageData(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

      for (let pixelIndex = 0; pixelIndex < logits.length; pixelIndex += 1) {
        const alpha = logitToAlphaByte(logits[pixelIndex]);
        const rgbaIndex = pixelIndex * 4;
        matte.data[rgbaIndex] = 255;
        matte.data[rgbaIndex + 1] = 255;
        matte.data[rgbaIndex + 2] = 255;
        matte.data[rgbaIndex + 3] = alpha;
      }

      context.putImageData(matte, 0, 0);

      return canvas;
    },
    catch: () =>
      new ImageProcessingFailed({
        message: "The foreground matte could not be converted into an image mask.",
      }),
  });

export const createSourceComposite = (
  bitmap: ImageBitmap,
  matte: HTMLCanvasElement,
): Effect.Effect<HTMLCanvasElement, ImageProcessingFailed> =>
  Effect.try({
    try: () => {
      const output = document.createElement("canvas");
      output.width = bitmap.width;
      output.height = bitmap.height;

      const context = output.getContext("2d");

      if (context === null) {
        throw new Error("2D canvas is unavailable.");
      }

      context.drawImage(bitmap, 0, 0);
      context.globalCompositeOperation = "destination-in";
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(matte, 0, 0, bitmap.width, bitmap.height);
      context.globalCompositeOperation = "source-over";

      return output;
    },
    catch: () =>
      new ImageProcessingFailed({
        message: "The foreground matte could not be applied at the source image resolution.",
      }),
  });

export const canvasToPng = (canvas: HTMLCanvasElement): Effect.Effect<Blob, ExportFailed> =>
  Effect.tryPromise({
    try: () =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) {
            reject(new Error("PNG encoding returned no blob."));

            return;
          }

          resolve(blob);
        }, "image/png");
      }),
    catch: () =>
      new ExportFailed({
        message: "The transparent image could not be encoded as PNG.",
      }),
  });
