/** Decode DAVIS palette/colour masks without discarding green or blue instances. */
export type InstanceRegion = {
  readonly rgb: readonly [number, number, number];
  readonly pixels: number;
  readonly mask: Uint8Array;
  readonly seed: { readonly x: number; readonly y: number };
};

export const annotatedForeground = (rgba: Uint8ClampedArray): Uint8Array => {
  if (rgba.length % 4 !== 0) throw new Error("Annotation RGBA buffer is incomplete.");

  const mask = new Uint8Array(rgba.length / 4);

  for (let i = 0; i < mask.length; i += 1) {
    const offset = 4 * i;

    mask[i] = (rgba[offset + 3] ?? 0) !== 0 &&
      ((rgba[offset] ?? 0) !== 0 ||
       (rgba[offset + 1] ?? 0) !== 0 ||
       (rgba[offset + 2] ?? 0) !== 0) ? 1 : 0;
  }

  return mask;
};

/**
 * Research fixtures only: derive synthetic user clicks from annotation
 * colours, never choose an ONNX mask proposal using ground truth.
 */
export const annotationInstances = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  minPixels = 32,
): readonly InstanceRegion[] => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height * 4 !== rgba.length ||
      !Number.isSafeInteger(minPixels) || minPixels < 1) {
    throw new Error("Invalid annotation geometry or minimum object size.");
  }

  const groups = new Map<number, { count: number; sumX: number; sumY: number }>();

  for (let i = 0; i < width * height; i += 1) {
    const offset = 4 * i;

    if ((rgba[offset + 3] ?? 0) === 0) continue;

    const color = ((rgba[offset] ?? 0) << 16) |
      ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);

    if (color === 0) continue;

    const group = groups.get(color) ?? { count: 0, sumX: 0, sumY: 0 };

    group.count += 1;
    group.sumX += i % width;
    group.sumY += Math.floor(i / width);
    groups.set(color, group);
  }

  const instances: InstanceRegion[] = [];

  for (const [color, group] of groups) {
    if (group.count < minPixels) continue;

    const mask = new Uint8Array(width * height);
    const centerX = group.sumX / group.count;
    const centerY = group.sumY / group.count;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < mask.length; i += 1) {
      const offset = 4 * i;

      const pixelColor = ((rgba[offset] ?? 0) << 16) |
        ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);

      if ((rgba[offset + 3] ?? 0) === 0 || pixelColor !== color) continue;

      mask[i] = 1;

      const x = i % width;
      const y = Math.floor(i / width);
      const distance = (x - centerX) ** 2 + (y - centerY) ** 2;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) throw new Error("Annotation instance has no representative pixel.");

    instances.push({
      rgb: [(color >> 16) & 255, (color >> 8) & 255, color & 255],
      pixels: group.count,
      mask,
      seed: {
        x: ((bestIndex % width) + 0.5) / width,
        y: (Math.floor(bestIndex / width) + 0.5) / height,
      },
    });
  }

  return instances.sort((a, b) => b.pixels - a.pixels);
};
