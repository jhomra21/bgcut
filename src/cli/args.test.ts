import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

import { parseCliArgs } from "./args";

const parse = (args: readonly string[]) => Effect.runPromise(parseCliArgs(args));

const parseFailure = async (args: readonly string[]): Promise<string> => {
  const result = await Effect.runPromise(
    parseCliArgs(args).pipe(
      Effect.match({
        onFailure: (error) => error.message,
        onSuccess: () => "",
      }),
    ),
  );

  return result;
};

describe("parseCliArgs", () => {
  test("defaults to a PNG next to the input", async () => {
    expect(await parse(["images/cat.jpg"])).toEqual({
      kind: "run",
      options: {
        inputPath: "images/cat.jpg",
        outputPath: "images/cat-nobg.png",
        format: "png",
        engine: "auto",
      },
    });
  });

  test("accepts long format flags without a value", async () => {
    expect(await parse(["cat.jpg", "--webp"])).toEqual({
      kind: "run",
      options: {
        inputPath: "cat.jpg",
        outputPath: "cat-nobg.webp",
        format: "webp",
        engine: "auto",
      },
    });
  });

  test("accepts compact word-style format flags", async () => {
    expect(await parse(["cat.jpg", "-png"])).toEqual({
      kind: "run",
      options: {
        inputPath: "cat.jpg",
        outputPath: "cat-nobg.png",
        format: "png",
        engine: "auto",
      },
    });
  });

  test("infers format from an explicit output filename", async () => {
    expect(await parse(["cat.jpg", "-o", "cutout.webp"])).toEqual({
      kind: "run",
      options: {
        inputPath: "cat.jpg",
        outputPath: "cutout.webp",
        format: "webp",
        engine: "auto",
      },
    });
  });

  test("appends the selected extension to an extensionless output", async () => {
    expect(await parse(["cat.jpg", "-webp", "-o", "cutout"])).toEqual({
      kind: "run",
      options: {
        inputPath: "cat.jpg",
        outputPath: "cutout.webp",
        format: "webp",
        engine: "auto",
      },
    });
  });

  test("normalizes jpeg to the jpg output contract", async () => {
    expect(await parse(["cat.png", "--jpeg"])).toEqual({
      kind: "run",
      options: {
        inputPath: "cat.png",
        outputPath: "cat-nobg.jpg",
        format: "jpg",
        engine: "auto",
      },
    });
  });

  test("supports an explicit GPU engine", async () => {
    expect(await parse(["cat.jpg", "-gpu"])).toEqual({
      kind: "run",
      options: {
        inputPath: "cat.jpg",
        outputPath: "cat-nobg.png",
        format: "png",
        engine: "gpu",
      },
    });
  });

  test("rejects the format-value syntax", async () => {
    expect(await parseFailure(["cat.jpg", "--format", "png"]))
      .toContain("Use the format itself as a flag");
  });

  test("rejects conflicting format flags", async () => {
    expect(await parseFailure(["cat.jpg", "--png", "-webp"]))
      .toBe("Only one output format can be specified.");
  });

  test("rejects a format that conflicts with the output extension", async () => {
    expect(await parseFailure(["cat.jpg", "--png", "-o", "cutout.webp"]))
      .toContain("conflicts with the requested --png format");
  });

  test("returns help without requiring an input", async () => {
    expect(await parse(["--help"])).toEqual({ kind: "help" });
  });
});
