# removebg-webgpu

Browser-only background removal built with Solid 2, Effect, ONNX Runtime WebGPU, and TypeGPU.

The current cut is deliberately direct: a pinned BiRefNet Lite 512 ONNX model performs segmentation on WebGPU, while the final alpha matte is applied to the original-resolution source image in the browser. No source image is uploaded to an application backend.

## What works

- PNG, JPEG, and WebP input through drag/drop or the file picker
- one application-owned `GPUDevice`
- ONNX Runtime WebGPU configured to use that exact device
- TypeGPU initialized from that exact device
- Effect-tagged failures around GPU initialization, model download/load, image decode, inference, processing, and export
- BiRefNet Lite inference at 512 × 512
- ImageNet normalization matching the model card
- sigmoid matte conversion
- full source-resolution transparent PNG composition/export
- model and session reuse after the first run
- oxlint with the strict 15-rule anti-slop profile plus the Effect anti-slop rule

## Model

The MVP pins `studioludens/birefnet-lite-512` at revision:

```text
4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7
```

It currently uses the fp32 ONNX artifact (`onnx/model.onnx`, about 183 MB). The model is MIT licensed. Its documented contract is RGB input resized to 512 × 512, ImageNet normalization, NCHW layout, and a single-channel logits output that requires an external sigmoid.

The fp32 choice is intentional for the first acceptance pass. Once the direct ONNX Runtime + shared WebGPU device path is proven across target browsers, the smaller fp16 artifact can be introduced as a separate optimization.

Model source: <https://huggingface.co/studioludens/birefnet-lite-512>

## Local development

```sh
bun install
bun run check
bun run dev
```

Open the Vite URL in a browser with WebGPU support. The expected acceptance flow is:

1. The runtime panel reports all five checks as ready.
2. Drop a PNG, JPEG, or WebP image.
3. Click **Remove background**.
4. On the first run, allow the pinned fp32 model to download and initialize.
5. Confirm the transparent result appears next to the original.
6. Download the PNG and confirm its dimensions match the source image.
7. Run a second image and confirm the model does not need to be re-created.

## Architecture

```text
Solid 2 UI
   |
   | typed commands / state
   v
Effect boundary
   |
   +-- image decode
   +-- GPU initialization / device loss
   +-- model download / session lifecycle
   +-- inference / export failures
   |
   v
one GPUDevice
   |             |
   v             v
ONNX Runtime   TypeGPU
WebGPU         shared GPU foundation
   |
   v
BiRefNet 512 logits
   |
   v
Canvas 2D matte + source-resolution composite
```

The first cut intentionally keeps preprocessing and compositing on Canvas 2D. That makes the model contract and output easy to validate before optimizing data movement. TypeGPU already owns the same `GPUDevice`; the next performance step is moving resize/normalization, matte refinement, and compositing onto that GPU pipeline without changing the Solid UI contract.

## Validation

Before a change is complete:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
```

`bun run check` runs all four gates in order.
