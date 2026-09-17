---
name: bgcut
description: Remove image backgrounds locally with the bgcut CLI. Use for transparent cutouts from local JPEG, PNG, WebP, or AVIF files, including cases where the filename extension is wrong.
---

# bgcut

Use `bgcut` to remove an image background on the user's machine. The CLI runs inference locally. It may download the pinned model on the first run, but it does not upload the source image to an application inference backend.

## Install

bgcut is in beta. Use the npm `beta` tag until a stable release exists.

Run without a global install:

```sh
bunx bgcut@beta input.jpg
```

Or install globally:

```sh
npm install -g bgcut@beta
bgcut input.jpg
```

The installed CLI currently requires Bun.

## Basic command

The default output is a transparent PNG next to the input:

```sh
bgcut photo.jpg
```

Choose the output path:

```sh
bgcut photo.jpg -o portrait.png
```

Choose the output format with a format flag:

```sh
bgcut photo.jpg --png
bgcut photo.jpg --webp
bgcut photo.jpg --jpg
```

The `-png`, `-webp`, and `-jpg` aliases also work.

Do not use `--format png`. bgcut does not support that syntax.

## Input formats

The supported input contract is JPEG, PNG, WebP, and AVIF.

The CLI uses Sharp and libvips to inspect the image contents. It does not trust the filename extension alone. An AVIF file can therefore work even when its name ends in `.jpg`.

Do not claim support for every format Sharp can decode. Treat only JPEG, PNG, WebP, and AVIF as supported bgcut inputs.

## Output formats

- PNG is the default and preserves transparency.
- WebP is lossless and preserves transparency.
- JPG and JPEG have no alpha channel. bgcut places the cutout on white.

If `-o` ends in `.png`, `.webp`, `.jpg`, or `.jpeg`, bgcut can infer the output format. A conflicting explicit format flag is an error.

## Engine selection

Automatic mode tries native ONNX Runtime WebGPU first and uses the CPU provider if a WebGPU session cannot start:

```sh
bgcut photo.jpg
```

Require one provider only when the user asks for it or when diagnosing a machine:

```sh
bgcut photo.jpg --gpu
bgcut photo.jpg --cpu
```

The `-gpu` and `-cpu` aliases also work.

If the user explicitly chooses `--gpu`, do not silently retry on CPU. Preserve the requested constraint and report the failure.

## Model cache

The first run may download the pinned BiRefNet Lite 512 ONNX model, about 187 MiB. bgcut stores it in the operating system user cache and verifies the expected artifact before use.

A valid cached model is reused on later runs.

## Agent procedure

When the user asks to remove a background:

1. Use the local input path they provide.
2. Use PNG unless they request another output format.
3. Use automatic engine selection unless they ask for GPU or CPU specifically.
4. Run `bgcut <input> -o <output>`.
5. Report the output path and the engine selected by bgcut.
6. If decoding fails, report the decoder error. Do not guess the real file type from its extension.
7. If automatic WebGPU setup fails, allow bgcut to use CPU.
8. Do not upload the image to a remote background-removal service unless the user explicitly asks to use a remote service.

## Examples

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

## Current limits

- One input image is processed per command.
- Performance depends on the machine and provider.
- Browser warm-run timings are not CLI one-shot timings.
- The browser and CLI share the supported image types, but they use different decoders and runtime paths.
