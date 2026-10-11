import { annotatedForeground, annotationInstances } from "./annotation-instances";

const fixtures = [
  "bear",
  "camel",
  "bmx-trees",
  "breakdance",
  "dance-twirl",
  "judo",
  "soapbox",
  "cows",
] as const;

const inspect = async (fixture: string) => {
  const response = await fetch(`/quality/${fixture}/00000.png`);

  if (!response.ok) {
    throw new Error(`Cannot inspect DAVIS ${fixture} mask: HTTP ${response.status}.`);
  }

  const bitmap = await createImageBitmap(await response.blob());

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (context === null) throw new Error("DAVIS mask canvas unavailable.");

    context.drawImage(bitmap, 0, 0);

    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const union = annotatedForeground(pixels);
    const instances = annotationInstances(pixels, bitmap.width, bitmap.height, 128);
    const foreground = union.reduce((sum, value) => sum + value, 0);
    const instancePixels = instances.reduce((sum, instance) => sum + instance.pixels, 0);

    return {
      fixture,
      width: bitmap.width,
      height: bitmap.height,
      foreground,
      instancePixels,
      unassignedForeground: foreground - instancePixels,
      instances: instances.map((region) => ({
        rgb: region.rgb,
        pixels: region.pixels,
        seed: region.seed,
      })),
    };
  } finally {
    bitmap.close();
  }
};

const main = async () => {
  const reports = [];

  for (const fixture of fixtures) {
    try {
      reports.push(await inspect(fixture));
    } catch (error) {
      // The pinned DAVIS-Edit mirror may not expose every DAVIS sequence.
      // Keep the rest of the inventory instead of treating missing masks
      // as a model- or annotation-decoding failure.
      reports.push({
        fixture,
        unavailable: true,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const response = await fetch("/result", {
    method: "POST",
    body: JSON.stringify({ reports: [{ name: "davis-colour-instances", fixtures: reports }] }),
  });

  if (!response.ok) throw new Error(`Cannot save DAVIS multi-instance inventory: HTTP ${response.status}.`);
};

void main().catch((error) => fetch("/failure", {
  method: "POST",
  body: JSON.stringify({ message: String(error), stack: error instanceof Error ? error.stack : "" }),
}));
