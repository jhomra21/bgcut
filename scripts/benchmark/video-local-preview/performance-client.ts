import {
  ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, EncodedPacketSink,
  Input, Mp4OutputFormat, Output, Quality,
} from "mediabunny";
import { createVideoSelection } from "../../../src/browser/video-experimental";
import { binaryMaskIou, davisBoundaryF } from "../video-segmentation/quality-metrics";

const save = async (name: string, blob: Blob) => {
  const response = await fetch(`/output/${name}`, { method: "POST", body: blob });

  if (!response.ok) throw new Error(await response.text());
};

const inspect = async (blob: Blob) => {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

  try {
    const track = await input.getPrimaryVideoTrack();

    if (track === null) throw new Error("Export has no video track.");
    const timestamps: number[] = [];

    for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      timestamps.push(packet.timestamp);
    }

    timestamps.sort((a, b) => a - b);
    const canvas = await new CanvasSink(track, { alpha: true }).getCanvas(0);

    if (canvas === null) throw new Error("Export cannot decode.");
    const pixels = canvas.canvas.getContext("2d")?.getImageData(0, 0, canvas.canvas.width, canvas.canvas.height).data;

    if (pixels === undefined) throw new Error("Export cannot be read.");

    return {
      count: timestamps.length, timestamps, duration: await input.computeDuration(), codec: track.codec,
      width: canvas.canvas.width, height: canvas.canvas.height,
      transparent: pixels.filter((value, index) => index % 4 === 3 && value < 32).length,
      pixels,
    };
  } finally {
    input.dispose();
  }
};

const generatedSixty = async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Missing test canvas.");
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat() });
  const source = new CanvasSource(canvas, { codec: "avc", quality: new Quality("high") });
  output.addVideoTrack(source);
  await output.start();

  for (let index = 0; index < 60; index += 1) {
    context.fillStyle = "#d4e6e0";
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = "#b72525";
    context.fillRect(30 + index * 2, 40, 60, 100);
    context.fillStyle = "white";
    context.font = "22px sans-serif";
    context.fillText(String(index), 40 + index * 2, 95);
    await source.add(index / 60, 1 / 60);
  }

  source.close();
  await output.finalize();

  if (target.buffer === null) throw new Error("Missing 60 fps fixture.");

  return new File([target.buffer], "genuine-sixty.mp4", { type: "video/mp4" });
};

const benchmark = async (name: string, file: File, points: readonly { x: number; y: number; label: 1 }[]) => {
  const editor = createVideoSelection(file);

  const subjects = points.map((point, index) => ({
    id: `subject-${index}`,
    prompt: { points: [point, ...points.flatMap((other, otherIndex) => otherIndex === index ? [] : [{ ...other, label: 0 as const }])] },
  }));

  const cases = [];
  let started = performance.now();

  try {
    await editor.prepare(() => undefined);
    const modelMs = performance.now() - started;
    started = performance.now();
    const seedTime = name === "bmx-trees" ? 0.5 : 0;
    await editor.prepareFrame(seedTime, new AbortController().signal);
    const frameWarmMs = performance.now() - started;
    started = performance.now();
    await editor.preview(seedTime, subjects, new AbortController().signal);
    const firstClickMs = performance.now() - started;
    started = performance.now();
    await editor.preview(seedTime, subjects, new AbortController().signal);
    const warmClickMs = performance.now() - started;

    for (const frameRate of name === "sixty" ? ["source"] as const : [6, "source"] as const) {
      let firstFrame: Uint8ClampedArray | undefined;
      const stages: Partial<Record<string, number>> = {};
      started = performance.now();

      const result = await editor.run({
        subjects, seedTimeSeconds: seedTime,
        export: { start: 0, end: 1, frameRate, format: "mp4", quality: frameRate === 6 ? "medium" : "high" },
        onProgress: (update) => { stages[update.stage] ??= performance.now() - started; },
        onFrame: (canvas, index) => {
          if (index === 0) firstFrame = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
        },
      });

      const totalMs = performance.now() - started;

      if (result.timings.trackingMs <= 0 || result.timings.decodingMs < 0 || result.timings.encodingMs <= 0) {
        throw new Error("Missing measured processing stages.");
      }

      await save(`${name}-${frameRate}.mp4`, result.blob);
      const decoded = await inspect(result.blob);
      const expected = name === "sixty" ? 60 : frameRate === 6 ? 6 : 24;

      if (decoded.count !== expected || result.frameCount !== expected || new Set(decoded.timestamps).size !== expected) {
        throw new Error(`Incorrect real source cadence for ${name}: ${decoded.count}, expected ${expected}`);
      }

      if (firstFrame === undefined) throw new Error("No composited reference.");
      let squaredError = 0;
      let rgbSum = 0;

      for (let index = 0; index < firstFrame.length; index += 1) {
        if (index % 4 === 3) continue;
        rgbSum += firstFrame[index] ?? 0;
        squaredError += ((firstFrame[index] ?? 0) - (decoded.pixels[index] ?? 0)) ** 2;
      }

      const mse = squaredError / (result.width * result.height * 3);
      cases.push({
        frameRate, frames: result.frameCount, outputFps: result.sampleFps,
        totalMs, stages, bytes: result.blob.size, width: result.width, height: result.height,
        decodedDuration: decoded.duration, rgbSum, psnr: 10 * Math.log10(255 ** 2 / mse),
        timestamps: decoded.timestamps, timings: result.timings,
      });
    }

    // Compare unchanged single-frame segmentation against DAVIS rather than inventing smoothing.
    let quality;

    if (name === "bear") {
      const masks = await editor.preview(0, subjects, new AbortController().signal);
      const mask = masks[0];
      const bitmap = await createImageBitmap(await fetch("/quality/bear/00000.png").then((response) => response.blob()));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");

      if (mask === undefined || context === null) throw new Error("Missing quality input.");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const truth = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const expected = Uint8Array.from({ length: canvas.width * canvas.height }, (_, index) => (truth[index * 4] ?? 0) > 0 ? 1 : 0);

      const predicted = Uint8Array.from(expected, (_, index) => {
        const x = Math.floor(index % canvas.width * mask.width / canvas.width);
        const y = Math.floor(Math.floor(index / canvas.width) * mask.height / canvas.height);

        return (mask.alpha[y * mask.width + x] ?? 0) > 0 ? 1 : 0;
      });

      quality = { iou: binaryMaskIou(predicted, expected), boundaryF: davisBoundaryF(predicted, expected, canvas.width, canvas.height) };
    }

    return { name, modelMs, frameWarmMs, firstClickMs, warmClickMs, cases, quality };
  } finally {
    await editor.close();
  }
};

const main = async () => {
  const reports = [];

  for (const name of ["bear", "bmx-trees"] as const) {
    const file = new File([await fetch(`/quality/${name}.mp4`).then((response) => response.blob())], `${name}.mp4`);

    const points = name === "bear"
      ? [{ x: 0.4, y: 0.65, label: 1 as const }]
      : [{ x: 0.531615925058548, y: 0.49375, label: 1 as const }, { x: 0.5011709601873536, y: 0.6895833333333333, label: 1 as const }];

    reports.push(await benchmark(name, file, points));
  }

  const sixty = await generatedSixty();
  await save("genuine-sixty-input.mp4", sixty);
  reports.push(await benchmark("sixty", sixty, [{ x: 0.18, y: 0.5, label: 1 }]));
  await fetch("/result", { method: "POST", body: JSON.stringify({ reports }) });
};

void main().catch((error) => fetch("/failure", {
  method: "POST", body: JSON.stringify({ message: String(error), stack: error instanceof Error ? error.stack : "" }),
}));
