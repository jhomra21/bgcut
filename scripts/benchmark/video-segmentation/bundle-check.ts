import { join } from "node:path";

const result = await Bun.build({
  entrypoints: [
    join(
      import.meta.dir,
      "client-smoke.ts",
    ),
    join(
      import.meta.dir,
      "probe-client.ts",
    ),
    join(
      import.meta.dir,
      "temporal-smoke-client.ts",
    ),
    join(
      import.meta.dir,
      "quality-smoke-client.ts",
    ),
  ],
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "inline",
});

if (!result.success) {
  throw new Error(
    `Video segmentation benchmark bundle failed.\n${result.logs
      .map((log) => log.message)
      .join("\n")}`,
  );
}

if (result.outputs.length !== 4) {
  throw new Error(
    `Video segmentation benchmark produced ${result.outputs.length} browser bundles instead of four.`,
  );
}

const sources = await Promise.all(
  result.outputs.map(
    (output) => output.text(),
  ),
);

const combined = sources.join("\n");

for (const expected of [
  "sam21-tiny",
  "edgetam",
  "The benchmark input has no video track.",
  "Video model probe requires WebGPU.",
  "VIDEO TEMPORAL SMOKE FAILED",
  "VIDEO QUALITY SMOKE FAILED",
]) {
  if (!combined.includes(expected)) {
    throw new Error(
      `Video segmentation bundle is missing ${expected}.`,
    );
  }
}

console.log("Video segmentation benchmark bundle check passed.");
