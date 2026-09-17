import { describe, expect, test } from "bun:test";

const appSource = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

const sourceInputBlock = (): string => {
  const start = appSource.indexOf('id="source-file-input"');

  if (start < 0) {
    throw new Error("Could not find source-file-input in App.tsx.");
  }

  const end = appSource.indexOf("/>", start);

  if (end < 0) {
    throw new Error("Could not find the end of source-file-input in App.tsx.");
  }

  return appSource.slice(start, end);
};

describe("browser product UI", () => {
  test("uses one image picker with the supported browser formats", () => {
    const input = sourceInputBlock();

    expect(input).toContain("image/png");
    expect(input).toContain("image/jpeg");
    expect(input).toContain("image/webp");
    expect(input).toContain("image/avif");
    expect(appSource.match(/type="file"/gu)?.length).toBe(1);
  });

  test("matches the minimal product flow", () => {
    expect(appSource).toContain("<h1>bgcut</h1>");
    expect(appSource).toContain('href="https://github.com/jhomra21/bgcut"');
    expect(appSource).toContain("GitHub");
    expect(appSource).toContain("Click or drag image here");
    expect(appSource).toContain("New Image");
    expect(appSource).toContain("Copy");
    expect(appSource).toContain("Download");
    expect(appSource).toContain("Redo");
    expect(appSource).not.toContain(">Reset<");
    expect(appSource).not.toContain("Remove background");
  });

  test("keeps developer diagnostics and external comparison controls out of the product UI", () => {
    const internalComparisonName = ["B", "G", "0"].join("");

    expect(appSource).not.toContain("diagnostics");
    expect(appSource).not.toContain("Pipeline timing");
    expect(appSource).not.toContain("Execution path");
    expect(appSource).not.toContain("reference-file-input");
    expect(appSource).not.toContain(internalComparisonName);
  });
});
