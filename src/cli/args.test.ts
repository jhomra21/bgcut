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
  test("opens the local app when no arguments are provided", async () => {
    expect(await parse([])).toEqual({
      kind: "serve",
      options: {
        port: 0,
        open: true,
        json: false,
      },
    });
  });

  test("supports explicit local app options", async () => {
    expect(await parse(["serve", "--port", "8787", "--no-open"])).toEqual({
      kind: "serve",
      options: {
        port: 8787,
        open: false,
        json: false,
      },
    });

    expect(await parse(["--json"])).toEqual({
      kind: "serve",
      options: {
        port: 0,
        open: false,
        json: true,
      },
    });
  });

  test("supports an explicit remove subcommand", async () => {
    expect(await parse(["remove", "images/cat.jpg"])).toEqual({
      kind: "run",
      options: {
        inputPaths: ["images/cat.jpg"],
        outputPath: undefined,
        format: undefined,
        engine: "auto",
      },
    });
  });

  test("accepts multiple image and directory inputs", async () => {
    expect(await parse(["images/", "cat.jpg", "dog.webp", "--webp", "-o", "out"])).toEqual({
      kind: "run",
      options: {
        inputPaths: ["images/", "cat.jpg", "dog.webp"],
        outputPath: "out",
        format: "webp",
        engine: "auto",
      },
    });
  });

  test("accepts format and engine flags without changing input order", async () => {
    expect(await parse(["cat.jpg", "-gpu", "dog.png", "-png"])).toEqual({
      kind: "run",
      options: {
        inputPaths: ["cat.jpg", "dog.png"],
        outputPath: undefined,
        format: "png",
        engine: "gpu",
      },
    });
  });

  test("preserves explicit output for runtime file-or-directory resolution", async () => {
    expect(await parse(["cat.jpg", "-o", "cutout.webp"])).toEqual({
      kind: "run",
      options: {
        inputPaths: ["cat.jpg"],
        outputPath: "cutout.webp",
        format: undefined,
        engine: "auto",
      },
    });
  });

  test("normalizes jpeg to the jpg output contract", async () => {
    expect(await parse(["cat.png", "--jpeg"])).toEqual({
      kind: "run",
      options: {
        inputPaths: ["cat.png"],
        outputPath: undefined,
        format: "jpg",
        engine: "auto",
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

  test("returns help without requiring an input", async () => {
    expect(await parse(["--help"])).toEqual({ kind: "help" });
    expect(await parse(["serve", "--help"])).toEqual({ kind: "help" });
  });

  test("rejects invalid local app ports", async () => {
    expect(await parseFailure(["serve", "--port", "99999"]))
      .toContain("Invalid port");
  });

  test("requires at least one input for headless removal", async () => {
    expect(await parseFailure(["remove", "--png"]))
      .toContain("At least one input image or directory path is required");
  });
});
