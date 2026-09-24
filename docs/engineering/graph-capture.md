# WebGPU graph capture

This document records the earlier graph-capture experiment that established the Chromium-family browser path. The numbers are observations from one exact commit and test setup. They are not general product claims. Safari now uses the no-capture session path; its FP16 acceptance results are recorded in [benchmarks](./benchmarks.md).

## Accepted candidate

Exact SHA:

`fa9f11bf9decc5e4a30a1011ba7fac757519ef1f`

Accepted implementation: PR #16, branch `perf/graph-capture-sum-add-runtime`.

Runtime and model:

- ONNX Runtime Web `1.30.0`
- one application-owned WebGPU device shared with TypeGPU
- TypeGPU preprocessing into a persistent GPU input buffer
- persistent GPU output with explicit readback
- ONNX Runtime graph capture enabled
- BiRefNet Lite 512 ORT BASIC WebGPU rewrite v2
- model SHA-256 `4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c`
- model size `195,872,736` bytes

## Model rewrites

The first graph-capture candidate could not create a session because ONNX Runtime did not assign the full graph to WebGPU.

Two graph changes fixed that without changing deterministic CPU output.

1. Forty `Slice` nodes used `INT64` data. ONNX Runtime 1.30 WebGPU `Slice` accepts floating-point data. Each one-element axis-3 slice was replaced with an equivalent `Gather`.
2. The rewritten graph still had twenty four-input ONNX `Sum` nodes. ONNX Runtime 1.30 does not register `Sum` for WebGPU. Each `Sum(a,b,c,d)` was replaced with `Add(Add(Add(a,b),c),d)`.

The v2 graph has:

- nodes: `2,660` to `2,700`
- `Sum`: `20` to `0`
- `Add`: `171` to `231`
- deterministic max absolute logit difference: `0.0`
- deterministic mean absolute logit difference: `0.0`
- deterministic max sigmoid difference: `0.0`
- ONNX Runtime `ENABLE_ALL` optimization check: `Sum = 0`

## Accepted browser benchmark

The same 1600x1598 cat fixture was used for one cold run and five warm reruns without reloading.

| Metric | Cold | Warm median |
| --- | ---: | ---: |
| Total | 7,614 ms | **422 ms** |
| GPU prep enqueue | 6.8 ms | 0.7 ms |
| Inference | 1,215 ms | 1.3 ms |
| GPU readback | 244 ms | 353 ms |
| Matte | 5.9 ms | 3.2 ms |
| Composite | 0.8 ms | 0.1 ms |
| PNG export | 66 ms | 52 ms |
| Model fetch | 5,005 ms | 0 ms |
| Session init | 1,056 ms | 0 ms |

Warm totals were `550`, `418`, `418`, `422`, and `426` ms.

With graph capture enabled, the measured `session.run()` span mostly represents submission overhead. GPU completion is visible in the explicit readback stage, so end-to-end total is the useful comparison.

Controlled warm totals:

- PR #9: `1,641 ms`
- optimized model without graph capture, PR #14: `1,492 ms`
- graph capture, PR #16: `422 ms`

PR #16 was `1,070 ms` lower than PR #14, about `71.7%`, and `1,219 ms` lower than PR #9, about `74.3%`.

## Correctness checks

The accepted head also passed these checks:

- transparent RGBA 1600x1598 cat output with retained fur, ears, whiskers, and thin edges
- transparent RGBA 1200x800 dog output
- typed SVG rejection with `Unsupported image type: image/svg+xml`
- startup WebGPU and TypeGPU checks
- no console warnings or errors
- no uncaught exceptions
- no device crashes

## Production model delivery

The graph-capture experiment first used a development Vite proxy because GitHub Release assets were not suitable as a direct browser model origin.

The current production path keeps model delivery same-origin while inference stays local:

- Chromium-family WebGPU and browser WebAssembly request `/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx`
- Safari WebGPU requests `/models/birefnet-lite-512-ort-basic-webgpu-v2-fp16.onnx` when the device exposes `shader-f16`; other Safari devices keep the FP32 path
- `MODEL_RELEASE_URL` and `WEBGPU_MODEL_RELEASE_URL` pin the two GitHub Release assets used by model preparation
- model preparation verifies the exact byte count and SHA-256 for both artifacts
- Cloudflare production keeps both model files out of Workers Static Assets
- private R2 stores the validated model artifacts, and the Worker serves them through `/models/*` under the same `bgcut.dev` origin
- model files stay out of Git history

Source images stay on the user's machine, and inference runs locally.

See [`../operations/deploying.md`](../operations/deploying.md) for the current R2 bootstrap and production deployment flow.
