import { join } from "node:path";

const result = await Bun.build({
  entrypoints: [
    join(
      import.meta.dir,
      "client-smoke.ts",
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

const output = result.outputs.at(0);

if (output === undefined) {
  throw new Error("Video segmentation benchmark produced no browser bundle.");
}

const source = await output.text();

for (const expected of [
  "sam21-tiny",
  "edgetam",
  "VideoSampleSink",
]) {
  if (!source.includes(expected)) {
    throw new Error(
      `Video segmentation bundle is missing ${expected}.`,
    );
  }
}

console.log("Video segmentation benchmark bundle check passed.");
