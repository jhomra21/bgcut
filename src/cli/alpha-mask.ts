export const compositeAlphaMask = (
  rgba: Uint8Array,
  mask: Uint8Array,
  maskChannels: number,
): void => {
  if (!Number.isInteger(maskChannels) || maskChannels < 1) {
    throw new Error(`Mask channel count must be a positive integer; received ${maskChannels}.`);
  }

  if (rgba.length % 4 !== 0) {
    throw new Error(`RGBA byte length must be divisible by 4; received ${rgba.length}.`);
  }

  const pixelCount = rgba.length / 4;
  const requiredMaskBytes = pixelCount * maskChannels;

  if (mask.length < requiredMaskBytes) {
    throw new Error(`Mask contains ${mask.length} bytes; expected at least ${requiredMaskBytes}.`);
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const rgbaAlphaIndex = pixelIndex * 4 + 3;
    const maskIndex = pixelIndex * maskChannels;
    const maskAlpha = mask[maskIndex];

    rgba[rgbaAlphaIndex] = Math.round((rgba[rgbaAlphaIndex] * maskAlpha) / 255);
  }
};
