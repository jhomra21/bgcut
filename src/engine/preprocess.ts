const imageNetMean = [0.485, 0.456, 0.406] as const;
const imageNetStd = [0.229, 0.224, 0.225] as const;

export const normalizeRgbaToNchw = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array => {
  const pixelCount = width * height;
  const tensor = new Float32Array(pixelCount * 3);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    tensor[pixelIndex] = (pixels[rgbaIndex] / 255 - imageNetMean[0]) / imageNetStd[0];
    tensor[pixelCount + pixelIndex] = (pixels[rgbaIndex + 1] / 255 - imageNetMean[1]) / imageNetStd[1];
    tensor[pixelCount * 2 + pixelIndex] = (pixels[rgbaIndex + 2] / 255 - imageNetMean[2]) / imageNetStd[2];
  }

  return tensor;
};
