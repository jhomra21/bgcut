# removebg-webgpu

Local-first background removal built around an application-owned WebGPU device.

The browser owns one `GPUDevice` and shares it with ONNX Runtime WebGPU and TypeGPU. The current bootstrap uses BiRefNet Lite 512 for segmentation and preserves source resolution for transparent PNG export. Image uploads are not required for inference.

## Direction

This project is not intended to stop at "background removal in the browser." The architectural target is a GPU-native cutout editor where inference, preprocessing, matte refinement, compositing, and interactive mask edits can share one WebGPU pipeline with minimal CPU/GPU round trips.

Local execution alone is not a differentiator from projects such as BG0. The intended differentiation is lower-level ownership of the GPU pipeline and the editing/refinement capabilities that ownership makes possible. Performance and output-quality claims must be benchmarked rather than assumed.

Near-term work:

- move preprocessing and matte post-processing from Canvas 2D into TypeGPU
- add edge refinement controls such as feather, erode/dilate, despeckle, and edge decontamination
- add non-destructive restore/erase mask editing
- benchmark GPU memory traffic, latency, and cutout quality against alternative browser implementations
- add explicit compatibility/fallback behavior without silently changing output quality

## Development

```bash
bun install --frozen-lockfile
bun run check
bun run dev
```

`bun run check` runs canonical vendored anti-slop linting, TypeScript, product change-detector tests, and the production build.

Anti-slop is vendored from `dmmulroy/anti-slop`; see `tools/oxlint/anti-slop/UPSTREAM.md` for the exact upstream revision and provenance.
