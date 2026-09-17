# bgcut

Local background removal with WebGPU as the primary execution path.

The browser implementation uses a pinned BiRefNet Lite 512 ONNX model with ONNX Runtime WebGPU, shares one application-owned `GPUDevice` with TypeGPU, captures the inference graph, and exports transparent PNGs at the source image resolution.

## Development

```sh
bun install --frozen-lockfile
bun run dev
```

Run the full project checks with:

```sh
bun run check
```

That runs oxlint, TypeScript, product tests, the production build, and an npm package dry run. Vendored anti-slop maintainer tests are excluded from Bun's project-level test discovery through `bunfig.toml` because Oxlint `RuleTester` expects its upstream Node/tsx environment.

## Browser pipeline

```text
image
  -> source decode
  -> TypeGPU resize + ImageNet normalization on the shared WebGPU device
  -> BiRefNet Lite ONNX inference with WebGPU graph capture
  -> GPU output readback
  -> alpha matte
  -> source-resolution compositing
  -> transparent PNG
```

The model artifact is verified by exact byte count and SHA-256 during production builds. Source images never go to an inference backend.

## Native CLI

The first npm release is published on the `beta` tag. The CLI currently runs on Bun, so install Bun before installing or invoking `bgcut`.

Install the beta globally with npm:

```sh
npm install -g bgcut@beta
```

Or with Bun:

```sh
bun add -g bgcut@beta
```

For a one-off run without a global install:

```sh
bunx bgcut@beta photo.jpg
```

The canonical command is `bgcut`:

```sh
bgcut photo.jpg
bgcut photo.jpg --png
bgcut photo.jpg -png
bgcut photo.jpg --webp
bgcut photo.jpg -webp -o portrait.webp
bgcut photo.jpg -o portrait.png
```

From a source checkout, `bun run cli -- ...` runs the same entrypoint without installing the package binary.

The format itself is the option; there is deliberately no `--format png` syntax. PNG is the default. WebP is encoded losslessly. JPG/JPEG is supported, but because JPEG has no alpha channel it is flattened onto white.

The CLI uses the same validated ONNX model and shared normalization/matte functions. It tries native ONNX Runtime WebGPU in automatic mode and falls back to native CPU execution if WebGPU session creation is unavailable. Use `-gpu`/`--gpu` or `-cpu`/`--cpu` to require one engine while validating the native path. The selected engine is printed after each run.

The CLI does not launch Chromium and does not upload the input image. It caches the exact validated model in the operating system's user cache directory and verifies the model before use.

## BG0 comparison

After this build removes a background, the browser result uses a draggable comparison slider rather than two independent panes. By default it compares the original image with this build's result.

Use **Load BG0 output** to select a BG0 result from disk. The file stays local. The comparison requires the BG0 image to have the same width and height as this build's output so the two results remain pixel-aligned while dragging the divider.

This comparison is intended for local acceptance of hair, fur, whiskers, thin edges, holes, and semi-transparent boundaries. It is a visual inspection tool, not a substitute for numeric matte regression tests.

## Direction

Local execution alone is not a differentiator from projects such as BG0. The intended differentiation is lower-level ownership of the GPU pipeline and the editing/refinement capabilities that ownership makes possible. Performance and output-quality claims must be benchmarked rather than assumed.

The target is a GPU-native cutout editor rather than only a one-shot background remover. Near-term work includes stronger job/cancellation APIs, quality refinement, non-destructive restore/erase editing, compatibility fallback, persistence, and benchmark coverage.

See [`IMPROVEMENTS.md`](IMPROVEMENTS.md) for the prioritized roadmap, competitive baseline, benchmark plan, architecture direction, and exact manual-acceptance baseline.

## Model

- Model: `studioludens/birefnet-lite-512`
- Revision: `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`
- Validated runtime artifact: `birefnet-lite-512-ort-basic-webgpu-v2.onnx`
- Artifact size: `195,872,736` bytes
- SHA-256: `4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c`
- Inference size: 512×512
- Export size: original source dimensions

## Privacy

Source images, decoded pixels, masks, and generated outputs stay on the user's machine. The model is downloaded from the pinned release artifact; source images are not sent there or to an application inference backend.
