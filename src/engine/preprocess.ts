const imageNetMean = [0.485, 0.456, 0.406] as const;

const imageNetStd = [0.229, 0.224, 0.225] as const;

const normalizeChannel = (value: number, channel: 0 | 1 | 2): number =>
  (value - imageNetMean[channel]) / imageNetStd[channel];

export const normalizeRgbaToNchw = (
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array => {
  const pixelCount = width * height;
  const tensor = new Float32Array(pixelCount * 3);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    tensor[pixelIndex] = normalizeChannel(pixels[rgbaIndex] / 255, 0);
    tensor[pixelCount + pixelIndex] = normalizeChannel(pixels[rgbaIndex + 1] / 255, 1);
    tensor[pixelCount * 2 + pixelIndex] = normalizeChannel(pixels[rgbaIndex + 2] / 255, 2);
  }

  return tensor;
};

const clampIndex = (value: number, maximum: number): number =>
  Math.min(Math.max(value, 0), maximum);

export const resizeRgbaLinearToNchw = (
  pixels: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array => {
  const targetPixelCount = targetWidth * targetHeight;
  const tensor = new Float32Array(targetPixelCount * 3);
  const sourceMaxX = sourceWidth - 1;
  const sourceMaxY = sourceHeight - 1;

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = ((targetY + 0.5) * sourceHeight) / targetHeight - 0.5;
    const sourceYFloor = Math.floor(sourceY);
    const yMix = sourceY - sourceYFloor;
    const y0 = clampIndex(sourceYFloor, sourceMaxY);
    const y1 = clampIndex(sourceYFloor + 1, sourceMaxY);

    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = ((targetX + 0.5) * sourceWidth) / targetWidth - 0.5;
      const sourceXFloor = Math.floor(sourceX);
      const xMix = sourceX - sourceXFloor;
      const x0 = clampIndex(sourceXFloor, sourceMaxX);
      const x1 = clampIndex(sourceXFloor + 1, sourceMaxX);
      const topLeftIndex = (y0 * sourceWidth + x0) * 4;
      const topRightIndex = (y0 * sourceWidth + x1) * 4;
      const bottomLeftIndex = (y1 * sourceWidth + x0) * 4;
      const bottomRightIndex = (y1 * sourceWidth + x1) * 4;
      const targetIndex = targetY * targetWidth + targetX;

      for (let channel = 0 as 0 | 1 | 2; channel < 3; channel += 1) {
        const top = pixels[topLeftIndex + channel] * (1 - xMix)
          + pixels[topRightIndex + channel] * xMix;
        const bottom = pixels[bottomLeftIndex + channel] * (1 - xMix)
          + pixels[bottomRightIndex + channel] * xMix;
        const sampled = (top * (1 - yMix) + bottom * yMix) / 255;

        tensor[channel * targetPixelCount + targetIndex] = normalizeChannel(sampled, channel);
      }
    }
  }

  return tensor;
};