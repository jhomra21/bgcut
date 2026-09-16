# WebGPU graph capture

This document records the exact graph-capture experiment that produced the current fastest accepted browser result. Treat the numbers as exact-run observations, not general product claims.

## Accepted candidate

Exact SHA:

`fa9f11bf9decc5e4a30a1011ba7fac757519ef1f`

Draft PR:

`#16` — `perf/graph-capture-sum-add-runtime`

Runtime/model:

- ONNX Runtime Web `1.30.0`
- shared application-owned WebGPU device
- TypeGPU preprocessing into persistent app-owned GPU input
- persistent GPU output with explicit readback
- ORT graph capture enabled
- BiRefNet Lite 512 ORT BASIC WebGPU rewrite v2
- model SHA-256 `4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c`
- model size `195,872,736` bytes

## Why model rewriting was required

The first graph-capture candidate could not create an ONNX Runtime session because the graph was not fully assigned to the WebGPU execution provider.

Two exact incompatibilities were removed without changing deterministic CPU output:

1. 40 `Slice` nodes used `INT64` data, while ORT 1.30 WebGPU `Slice` accepts floating-point data. Each exact one-element axis-3 slice was rewritten to an equivalent int64-capable `Gather`.
2. The resulting graph still had 20 four-input ONNX `Sum` nodes. ORT 1.30 does not register `Sum` for WebGPU. Each `Sum(a,b,c,d)` was rewritten to `Add(Add(Add(a,b),c),d)`.

The v2 graph has:

- nodes: `2,660 -> 2,700`
- `Sum`: `20 -> 0`
- `Add`: `171 -> 231`
- deterministic max absolute logit difference: `0.0`
- deterministic mean absolute logit difference: `0.0`
- deterministic max sigmoid difference: `0.0`
- ORT `ENABLE_ALL` optimization check: `Sum = 0`

## Accepted browser benchmark

The same 1600×1598 cat fixture was used for one cold run plus five warm reruns without reloading.

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

With graph capture, the measured `session.run()` span is mostly submission overhead. GPU completion synchronization is visible in the explicit readback stage, so end-to-end total is the meaningful comparison.

Controlled warm-total comparison:

- accepted PR #9: `1,641 ms`
- optimized-model/no-capture PR #14: `1,492 ms`
- graph-capture PR #16: **`422 ms`**
- PR #16 vs PR #14: `1,070 ms` lower, about `71.7%`
- PR #16 vs PR #9: `1,219 ms` lower, about `74.3%`

## Correctness acceptance

The exact accepted head also passed:

- transparent RGBA 1600×1598 cat output with sensible fur, ears, whiskers, and thin edges
- sensible transparent RGBA 1200×800 dog output
- typed SVG rejection: `Unsupported image type: image/svg+xml`
- all startup WebGPU/TypeGPU checks
- no console warnings or errors
- no uncaught exceptions
- no device crashes

## Production model delivery

The accepted graph-capture runtime originally used a development-only Vite proxy because GitHub Release assets are not a browser-CORS-safe production origin.

The production-delivery follow-up keeps inference local while making the validated model same-origin:

- application runtime requests `/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx`
- development proxies that same path to the validated GitHub Release asset
- production build downloads the model server-side into `public/models/`
- the downloaded file must match the exact expected byte count and SHA-256 before Vite builds
- the copied `dist/models/` artifact is verified again after the build
- the 196 MB model is ignored by Git and is not committed to repository history

This changes model delivery only. It does not add an image-upload backend or move inference off the user's device.
