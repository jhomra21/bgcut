import { describe, expect, test } from "bun:test";

const appSource = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

const fileInputBlock = (id: string): string => {
  const start = appSource.indexOf(`id="${id}"`);

  if (start < 0) {
    throw new Error(`Could not find ${id} in App.tsx.`);
  }

  const end = appSource.indexOf("/>", start);

  if (end < 0) {
    throw new Error(`Could not find the end of ${id} in App.tsx.`);
  }

  return appSource.slice(start, end);
};

describe("file picker routing", () => {
  test("source and reference input clicks cannot bubble into the drop-zone source picker", () => {
    const sourceInput = fileInputBlock("source-file-input");
    const referenceInput = fileInputBlock("reference-file-input");
    const propagationBoundary = "onClick={(event) => event.stopPropagation()}";

    expect(sourceInput).toContain(propagationBoundary);
    expect(referenceInput).toContain(propagationBoundary);
  });
});
