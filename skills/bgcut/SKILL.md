---
name: bgcut
description: Remove image backgrounds locally with the bgcut CLI. Use when an agent needs a transparent cutout from a local image, wants a privacy-preserving background-removal command, needs to choose GPU or CPU execution, or must handle JPEG, PNG, WebP, or AVIF inputs without uploading source images.
---

# bgcut

Use `bgcut` for local background removal. Source image pixels stay on the user's machine. The CLI downloads the pinned model when needed, then runs inference locally with native WebGPU when available and native CPU as the automatic fallback.

## Release channel

bgcut is currently in beta. Prefer the `beta` npm tag until the project publishes a stable release.

For one-off use:

```sh
bunx bgcut@beta input.jpg
```

For a global install:

```sh
npm install -g bgcut@beta
bgcut input.jpg
```

The installed CLI currently requires Bun because the executable entrypoint uses Bun.

## Basic usage

The default output is a transparent PNG next to the input:

```sh
bgcut photo.jpg
```

Choose an output path with `-o` or `--output`:

```sh
bgcut photo.jpg -o portrait.png
```

Choose a format by using the format itself as a flag:

```sh
bgcut photo.jpg --png
bgcut photo.jpg --webp
bgcut photo.jpg --jpg
```

Compact aliases are also valid:

```sh
bgcut photo.jpg -png
bgcut photo.jpg -webp
bgcut photo.jpg -jpg
```

Do not invent `--format png`; bgcut deliberately does not support that syntax.

## Input formats

The native CLI delegates decoding to Sharp/libvips and detects supported image content from the bytes rather than trusting the filename extension. JPEG, PNG, WebP, and AVIF are supported by the shipped runtime. A file containing AVIF data can still work even if its filename ends in `.jpg`.

The browser UI accepts JPEG, PNG, WebP, and AVIF through the browser decoder.

## Output formats

- PNG is the default and preserves transparency.
- WebP is lossless and preserves transparency.
- JPG/JPEG has no alpha channel, so bgcut flattens the result onto white.

If `-o` includes `.png`, `.webp`, `.jpg`, or `.jpeg`, bgcut can infer the output format from the filename. A conflicting explicit format flag is an error.

## Engine selection

Automatic mode is the default:

```sh
bgcut photo.jpg
```

It tries native ONNX Runtime WebGPU first and falls back to native CPU if WebGPU session creation is unavailable.

Require one engine while diagnosing behavior:

```sh
bgcut photo.jpg --gpu
bgcut photo.jpg --cpu
```

The compact aliases `-gpu` and `-cpu` also work. Explicit GPU mode does not silently fall back to CPU.

## Model and caching

The first run may download the pinned BiRefNet Lite 512 ONNX model, roughly 187 MiB. The model is cached in the operating system user cache directory and verified before use. Later runs reuse a valid cache.

Do not treat the model download as an image upload. The model comes to the machine; source images are not sent to an application inference backend.

## Agent workflow

When asked to remove a background:

1. Confirm there is a local input path.
2. Prefer PNG output unless the user asks for another format.
3. Use automatic engine selection unless the user explicitly wants GPU or CPU diagnostics.
4. Run `bgcut <input> -o <output>`.
5. Report the output path and the engine bgcut selected.
6. If decode fails, do not guess from the extension alone; the CLI already performs content-based decoding. Report the actual decoder error.
7. If WebGPU fails in automatic mode, allow bgcut to use CPU. If the user explicitly requested `--gpu`, preserve that requirement instead of retrying silently on CPU.

## Examples

Transparent PNG:

```sh
bgcut ./cat.avif -o ./cat-transparent.png
```

Lossless transparent WebP:

```sh
bgcut ./product.png --webp -o ./product.webp
```

Force GPU for a validation run:

```sh
bgcut ./portrait.jpg --gpu -o ./portrait.png
```

Force CPU for comparison:

```sh
bgcut ./portrait.jpg --cpu -o ./portrait-cpu.png
```

## Boundaries

- Process one input image per command for now.
- Do not claim every image format Sharp can theoretically decode is a supported bgcut contract; the documented contract is JPEG, PNG, WebP, and AVIF.
- Do not promise identical performance across GPU hardware or CPU platforms.
- Do not describe browser warm-run timings as native CLI one-shot timings; they measure different runtime lifecycles.
- Do not upload images to a remote background-removal service as a fallback unless the user explicitly asks for a different remote tool.
