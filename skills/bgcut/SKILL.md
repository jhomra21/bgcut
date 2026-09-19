---
name: bgcut
description: Remove image backgrounds locally with the bgcut local app, CLI, or Node API. Use for local JPEG, PNG, WebP, or AVIF cutouts, including files whose extension is wrong.
---

# bgcut

Use `bgcut` for local background removal. Source images stay on the user's machine. The package may download the pinned model on first use, but it does not upload source images to an application inference backend.

## Install

Run the packaged local app without a global install:

```sh
npx bgcut
```

Run one headless removal without a global install:

```sh
npx bgcut input.jpg
```

Bun users can run the same package with `bunx bgcut`.

Or install globally:

```sh
npm install -g bgcut
bgcut
```

The published executable is built for Node. npm and npx users do not need Bun installed.

For the Node API:

```sh
npm install bgcut
```

## Choose how to run bgcut

Use the local app when the user wants the browser UI on their own machine:

```sh
bgcut
```

Use the CLI when the user wants file-in/file-out automation:

```sh
bgcut input.jpg -o output.png
```

Use the Node API when an application needs to keep one ONNX Runtime session alive across multiple removals.

## Local app

Running `bgcut` with no image opens the packaged web UI on a loopback address. The explicit form is:

```sh
bgcut serve
```

Useful server options:

```sh
bgcut serve --port 8787
bgcut serve --no-open
bgcut serve --json
```

`serve --json` does not open a browser. It prints one JSON object containing the resolved URL, host, port, and PID. Without `--port`, the operating system chooses an available port.

The local server binds to `127.0.0.1`. Its UI is the remover only; hosted Docs, GitHub navigation, Privacy, and Terms are not part of the local app. Non-root app routes redirect to `/`. The server also serves the validated cached model, installed ONNX Runtime browser assets, and a small health endpoint. Image processing still happens locally in the browser.

The browser UI supports these shortcuts:

- `Command/Ctrl+O`: choose an image
- `Command/Ctrl+V`: paste an image
- `N`: choose a new image
- `C`: copy the result
- `D`: download the result
- `R`: rerun removal
- Left and right arrow keys: move the comparison slider when it is focused

## CLI

Pass an image path to run headless removal:

```sh
bgcut photo.jpg
```

The explicit form also works:

```sh
bgcut remove photo.jpg
```

The default output is a transparent PNG next to the input. Choose an output path with `-o` or `--output`:

```sh
bgcut photo.jpg -o portrait.png
```

Choose the output format with a format flag:

```sh
bgcut photo.jpg --png
bgcut photo.jpg --webp
bgcut photo.jpg --jpg
```

The `-png`, `-webp`, and `-jpg` aliases also work. Do not use `--format png`.

### Input formats

Supported inputs are JPEG, PNG, WebP, and AVIF.

The native path uses Sharp and libvips to inspect image contents instead of trusting the filename extension alone. An AVIF file can therefore work even when its name ends in `.jpg`.

Do not claim support for every format Sharp can decode. Treat only JPEG, PNG, WebP, and AVIF as supported bgcut inputs.

### Output formats

- PNG is the default and preserves transparency.
- WebP is lossless and preserves transparency.
- JPG and JPEG have no alpha channel. bgcut places the cutout on white.

If `-o` ends in `.png`, `.webp`, `.jpg`, or `.jpeg`, bgcut can infer the output format. A conflicting explicit format flag is an error.

### Engine selection

Automatic mode tries native ONNX Runtime WebGPU first and uses the CPU provider if a WebGPU session cannot start:

```sh
bgcut photo.jpg
```

Require one provider only when the user asks for it or when diagnosing a machine:

```sh
bgcut photo.jpg --gpu
bgcut photo.jpg --cpu
```

The `-gpu` and `-cpu` aliases also work. If the user explicitly chooses `--gpu`, do not silently retry on CPU.

## Node API

Import `createBgcut` from `bgcut`:

```ts
import { writeFile } from "node:fs/promises";
import { createBgcut } from "bgcut";

const bgcut = await createBgcut();

try {
  const result = await bgcut.remove("photo.jpg", { format: "png" });
  await writeFile("photo-nobg.png", result.data);
} finally {
  await bgcut.close();
}
```

One created engine owns one ONNX Runtime session and reuses it across removals until `close()` is called.

Engine options:

- `createBgcut()` or `createBgcut({ engine: "auto" })`: try WebGPU, then CPU if session creation fails
- `createBgcut({ engine: "gpu" })`: require native WebGPU
- `createBgcut({ engine: "cpu" })`: require CPU

Inputs can be file paths, `Uint8Array`, or `ArrayBuffer`. Output formats are `png`, `webp`, and `jpg`.

## Model cache

The first native run may download the pinned BiRefNet Lite 512 ONNX model, about 187 MiB. bgcut stores it in the operating-system user cache and verifies its expected size and SHA-256 before use.

The CLI, packaged local app, and Node API share the same validated model cache. A valid cached model is reused on later runs.

## Agent procedure

When the user asks to remove a background:

1. Choose the local app, CLI, or Node API based on the requested workflow.
2. For one file, use PNG unless the user requests another output format.
3. Use automatic engine selection unless the user asks for GPU or CPU specifically.
4. Preserve explicit provider constraints. Do not turn a requested GPU-only run into CPU silently.
5. Report the output path and selected engine for CLI work.
6. If decoding fails, report the decoder error. Do not guess the real file type from its extension.
7. Reuse one `createBgcut()` instance when application code will process multiple images.
8. Close a Node API engine when the caller is finished with it.
9. Do not upload images to a remote background-removal service unless the user explicitly asks to use one.

## Examples

Open the local UI:

```sh
bgcut
```

Transparent PNG:

```sh
bgcut ./cat.avif -o ./cat-transparent.png
```

Lossless transparent WebP:

```sh
bgcut ./product.png --webp -o ./product.webp
```

Require GPU:

```sh
bgcut ./portrait.jpg --gpu -o ./portrait.png
```

Require CPU:

```sh
bgcut ./portrait.jpg --cpu -o ./portrait-cpu.png
```

Start a machine-readable local server:

```sh
bgcut serve --json
```

## Current limits

- One input image is processed per CLI command.
- Performance depends on the machine and provider.
- Browser warm-run timings are not CLI one-shot timings.
- Browser and native paths use different decoders and runtime providers.
- The large model is not bundled inside the npm tarball.
