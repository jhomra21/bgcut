# removebg-webgpu

Browser-only background removal using WebGPU as the primary execution path.

The current implementation uses a pinned BiRefNet Lite 512 ONNX model with ONNX Runtime WebGPU, shares one application-owned `GPUDevice` with TypeGPU, and exports transparent PNGs at the source image resolution.

## Development

```sh
bun install --frozen-lockfile
bun run dev
```

Run the full project checks with:

```sh
bun run check
```

That runs oxlint, TypeScript, product tests, and the production build. Vendored anti-slop maintainer tests are excluded from Bun's project-level test discovery through `bunfig.toml` because Oxlint `RuleTester` expects its upstream Node/tsx environment.

## Current pipeline

```text
image
  -> source decode
  -> 512×512 preprocessing
  -> BiRefNet Lite ONNX inference on WebGPU
  -> alpha matte
  -> source-resolution compositing
  -> transparent PNG
```

Preprocessing and final compositing currently use Canvas 2D. TypeGPU already shares the same WebGPU device as ONNX Runtime; moving measurable image-processing stages onto that shared GPU pipeline is the next architectural direction.

## Direction

Local execution alone is not a differentiator from projects such as BG0. The intended differentiation is lower-level ownership of the GPU pipeline and the editing/refinement capabilities that ownership makes possible. Performance and output-quality claims must be benchmarked rather than assumed.

The target is a GPU-native cutout editor rather than only a one-shot background remover. Near-term work includes GPU-resident image stages, stronger job/cancellation APIs, quality refinement, non-destructive restore/erase editing, compatibility fallback, persistence, and benchmark coverage.

See [`IMPROVEMENTS.md`](IMPROVEMENTS.md) for the prioritized roadmap, competitive baseline, benchmark plan, architecture direction, and exact manual-acceptance baseline.

## Model

- Model: `studioludens/birefnet-lite-512`
- Revision: `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`
- Current artifact: fp32 ONNX
- Inference size: 512×512
- Export size: original source dimensions

The first inference downloads the model. Later runs can reuse browser caching and the initialized in-page session.

## Privacy

Source images, decoded pixels, masks, and generated PNGs remain in the browser application. The model itself is downloaded from its pinned model host; source images are not sent there or to an application inference backend.
