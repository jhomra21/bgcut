# Benchmarks

This file records measured bgcut runtime results and the rules for comparing them.

These numbers belong to specific commits, images, runtimes, and machines. Do not reuse them as general performance claims.

## Cross-tool benchmark harness

The repository includes two benchmark commands. They keep timing and quality measurement separate so outputs from other tools can use the same quality scorer.

```sh
bun run benchmark:bgcut -- /path/to/manifest.json ./tmp/bench/bgcut gpu 5
bun run benchmark:score -- /path/to/manifest.json ./tmp/bench/bgcut ./tmp/bench/bgcut-quality.json
```

The manifest uses paths relative to the manifest file.

```json
{
  "cases": [
    {
      "id": "hair-01",
      "input": "inputs/hair-01.png",
      "mask": "masks/hair-01.png"
    }
  ]
}
```

`benchmark:bgcut` creates one reusable bgcut session, records model and session setup separately, records the first removal for each image, then records the median of the requested warm reruns. It writes source-resolution PNG results plus `timings.json`.

`benchmark:score` reads `<id>.png` from any tool output directory. Transparent PNGs use their alpha channel. Grayscale or RGB files are treated as masks. Output dimensions must match the reference mask. The report contains normalized alpha MAE and MSE plus foreground IoU and F1 at an alpha threshold of 128.

For a cross-tool run:

1. Use the exact same source files and reference masks.
2. Keep the machine, browser, power state, and network conditions fixed.
3. Report setup, first-run processing, and warm processing separately.
4. Use a reusable session for tools that support one. Do not compare a warm bgcut session with a competitor that starts a new process for every image.
5. Save every output at the source dimensions. Record any model-side resize separately.
6. Score the saved outputs with the same `benchmark:score` command.
7. For remote services, label timing as end-to-end API latency. It includes upload, server queue, processing, and download time and is not a local inference measurement.
8. Record the exact tool version, model, options, and model download size.

### Quality sets

Use more than one dataset. DIS5K is useful for reproducible dichotomous segmentation, but its V1.0 authors note that real-world humans, animals, and cars are underrepresented. Keep a separate alpha-detail set for hair, fur, thin structures, semi-transparent edges, product photography, and cases where foreground and background colors are similar.

Do not copy third-party benchmark images into this repository unless their terms allow redistribution. The DIS repository publishes separate dataset terms. Keep a local dataset checkout outside this repository and point the manifest at it.

For true soft-alpha reference mattes, add standard alpha-matting metrics such as SAD, gradient error, and connectivity error before treating the benchmark as a matting benchmark. The current scorer is intended for fast regression checks and cross-tool segmentation comparisons.

### Tools to compare

Use these as the first comparison set:

- [IMG.LY background-removal-js](https://github.com/imgly/background-removal-js) for a local browser comparison. Its public API has explicit preload, WebGPU or CPU selection, foreground segmentation, alpha-mask output, original-size output, and reusable mask application.
- [rembg](https://github.com/danielgatis/rembg) for a native local comparison. Record the model name because its current default BRIA RMBG model is much larger than bgcut's model and runs at a different input size. rembg also exposes optional color decontamination and ViTMatte edge refinement.
- [remove.bg](https://www.remove.bg/api) for a hosted-service quality reference. Keep its latency in a separate remote-service column because network and service time are part of the measurement.

Do not use published timing claims from another machine as a head-to-head result. They are useful for choosing what to measure, not for ranking tools.

### Published reference numbers

These numbers are context only. They were not collected on the same hardware or with the same model, input, output path, or timing boundaries.

| Tool | Environment | Reported number | Boundary |
| --- | --- | --- | --- |
| bgcut | Apple M3 Pro, earlier graph-capture path at `fa9f11bf` | 422 ms warm median | Full browser removal from decoded source through source-resolution PNG export |
| IMG.LY background-removal-js | Apple M3 Max, June 2024 WebGPU fp16 benchmark | about 100 ms on consecutive runs; about 300 ms for the first neural-network run | ONNX model initialization and neural-network execution, with model download discussed separately |

The IMG.LY post is useful as a WebGPU reference, but it is not evidence that either tool is faster. The earlier bgcut graph-capture timing records `session.run()` submission separately from later output-buffer synchronization, so the small submit span is not a GPU execution measurement.

Source: [IMG.LY's WebGPU benchmark](https://img.ly/blog/browser-background-removal-using-onnx-runtime-webgpu/).

### Ideas worth testing

The competitor review points to a small set of changes that fit bgcut:

- Add a mask-only or raw alpha output to the Node and browser APIs. This avoids encoding a full cutout when callers only need the matte and makes quality benchmarking cheaper.
- Add an explicit browser preload call and progress stages for model fetch, session creation, preprocessing, inference, readback, and encode.
- Test optional edge color decontamination after compositing. This targets background color fringing without changing the segmentation model.
- Test edge refinement as an opt-in quality mode for hair and other soft boundaries. Keep it out of the default fast path unless the benchmark shows a useful gain.
- Consider separate speed and quality model profiles only after measuring model size, cold-start cost, warm latency, and quality on the same suite.
- Measure whether model resource chunking improves interrupted downloads and repeat visits before changing the current model delivery path.

These are benchmark candidates, not accepted product features. Each one needs a quality result, a speed cost, and a clear API contract before it ships.

## Safari FP16 WebGPU acceptance

Accepted benchmark head:

`902ef8d44bcc7480e939091f2ab8fa22224c0592`

Environment:

- Apple M3 Pro
- Safari 26.3
- ONNX Runtime Web `1.30.0`
- eight separately launched Safari processes
- balanced `FP32, FP16, FP16, FP32, FP16, FP32, FP32, FP16` block order
- six reference images per block
- three warm removals per image
- 144 measured warm removals total
- every measured removal reused its session

The FP16 candidate converts the 410 floating-point initializers in the validated FP32 model to FP16 while keeping FP32 public tensor input and output. The FP16 artifact is `98,572,669` bytes with SHA-256 `37d4035765b97a0323729fdee787d16eb7238c39c467316e887c5292792f3e33`.

| Slice | FP32 inference / total median | FP16 inference / total median | Inference change | Total change |
| --- | ---: | ---: | ---: | ---: |
| Aggregate | 1101 / 1309 ms | 627.5 / 873.5 ms | -43.0% | -33.3% |
| FP32 first | 1070.5 / 1207 ms | 627 / 831.5 ms | -41.4% | -31.1% |
| FP16 first | 1118.5 / 1329 ms | 633.5 / 895 ms | -43.4% | -32.7% |
| Forward | 1073.5 / 1265.5 ms | 691.5 / 957 ms | -35.6% | -24.4% |
| Reverse | 1114 / 1352.5 ms | 607 / 782 ms | -45.5% | -42.2% |
| First position | 1070.5 / 1207 ms | 633.5 / 895 ms | -40.8% | -25.8% |
| Second position | 1118.5 / 1329 ms | 627 / 831.5 ms | -43.9% | -37.4% |

All four paired trials favored FP16. Inference improvements ranged from 21.6% to 50.6%, and total-latency improvements ranged from 5.3% to 46.0%.

| Image | FP32 total median | FP16 total median | Total change |
| --- | ---: | ---: | ---: |
| cat-amelia | 1339 ms | 973 ms | -27.3% |
| cat-yoda-kitten | 1412.5 ms | 746.5 ms | -47.2% |
| cat-in-sink | 1488 ms | 874.5 ms | -41.2% |
| dog-teya | 1613 ms | 1099.5 ms | -31.8% |
| dog-blind-dog | 984.5 ms | 790.5 ms | -19.7% |
| dog-molly | 1033.5 ms | 772 ms | -25.3% |

Aggregate reference-mask metrics improved slightly:

| Metric | FP32 | FP16 | FP16 delta |
| --- | ---: | ---: | ---: |
| MAE | 0.02255466 | 0.02200792 | -0.00054674 |
| MSE | 0.01933876 | 0.01876192 | -0.00057684 |
| IoU | 0.96425259 | 0.96511045 | +0.00085786 |
| F1 | 0.98180101 | 0.98224550 | +0.00044449 |

Yoda Kitten and Blind Dog had very small per-image metric regressions. Molly improved materially. The six binary-mask references are a regression sample, not a broad quality guarantee.

Same-model alpha was exact across the gate. Blind Dog retained the previously observed RGB-only variation in 16 of 144 within-block comparisons, with no alpha differences. All 108 same-model cross-context comparisons were byte-identical.

This gate supports selecting the FP16 artifact for Safari WebGPU. It does not establish a Chromium-family, browser WebAssembly, or native Node/CLI speedup, so those paths keep the FP32 artifact.

### Production selector smoke

Production integration head:

`3be6079f109d5b220109bb8b5342359ab07f5938`

A fresh Safari 26.3 process called the normal `removeBackgroundWebGpu()` selector on Cat in Sink. The server recorded one request for `/models/birefnet-lite-512-ort-basic-webgpu-v2-fp16.onnx` and zero requests for the FP32 model. The returned model revision matched `37d4035765b97a0323729fdee787d16eb7238c39c467316e887c5292792f3e33`.

The prime completed in 3,214 ms and did not reuse a session. The warm removal reused the session, measured 511 ms inference and 771 ms total, and produced a nonblank 2592×1944 PNG with alpha spanning 0 through 255.

This smoke verifies the production selector and delivery path. It is not a replacement for the balanced six-image benchmark above.

## Earlier accepted graph-capture path

Exact SHA:

`fa9f11bf9decc5e4a30a1011ba7fac757519ef1f`

Runtime and model:

- ONNX Runtime Web `1.30.0`
- one application-owned WebGPU device shared with TypeGPU
- TypeGPU preprocessing into a persistent GPU input buffer
- persistent GPU output with explicit readback
- ONNX Runtime graph capture enabled
- BiRefNet Lite 512 ORT BASIC WebGPU rewrite v2
- 512x512 inference input
- source-resolution PNG export

The same 1600x1598 cat fixture was used for one cold run and five warm reruns without reloading.

| Metric | Cold | Warm median |
| --- | ---: | ---: |
| Total | 7,614 ms | 422 ms |
| GPU prep enqueue | 6.8 ms | 0.7 ms |
| Inference | 1,215 ms | 1.3 ms |
| GPU readback | 244 ms | 353 ms |
| Matte | 5.9 ms | 3.2 ms |
| Composite | 0.8 ms | 0.1 ms |
| PNG export | 66 ms | 52 ms |
| Model fetch | 5,005 ms | 0 ms |
| Session init | 1,056 ms | 0 ms |

Warm totals were `550`, `418`, `418`, `422`, and `426` ms.

The explicit readback stage includes GPU completion synchronization, so the end-to-end total is more useful than the small `session.run()` span by itself.

See [`graph-capture.md`](./graph-capture.md) for the model rewrites and correctness checks behind this result.

## Native CLI acceptance

Accepted CLI head:

`3401587e6d4f5dcd51346cbec1e9fb49c918fc3c`

The final native CLI acceptance used the same 740x493 source image for GPU, automatic, and CPU runs on an ARM Mac.

Observed one-shot totals:

| Mode | Total | Selected provider |
| --- | ---: | --- |
| `--gpu` | 1.54 s | WebGPU |
| automatic | 1.81 s | WebGPU |
| `--cpu` | 2.09 s | CPU |

All three outputs were 740x493 RGBA. GPU and automatic outputs were byte-identical. CPU differed only by small floating-point output differences.

Against the saved browser output, the accepted CLI alpha comparison measured a mean absolute difference of `0.74/255`, with `2.18%` of pixels differing by more than 10 alpha levels.

Do not compare these one-shot CLI totals directly with browser warm-session totals. The browser reuses an initialized session while each CLI command starts a new process.

## Browser WebAssembly fallback acceptance

Accepted fallback head:

`e9310669450e4631aa86aac6b8e5dfba8ca6ef50`

The accepted fallback used the same pinned model through ONNX Runtime WebAssembly when WebGPU was unavailable or explicitly disabled for diagnostics.

Observed cat totals:

- cold: `20.14 s`
- warm: `4.94 s`

The warm dog run was `4.86 s`.

The fallback kept source-resolution output and produced sensible transparent results. It is a compatibility path, not the browser performance target.

## Earlier browser experiments

The following results are useful when tracing how the current pipeline was reached.

| Exact SHA | Result | Main finding |
| --- | --- | --- |
| `8567c5294cfa88a27c08bf55bed40c7d5dd68b07` | accepted | CPU-backed output baseline on ONNX Runtime Web 1.29.0 |
| `4a2e07de544433ad2b321cb4e29be28a74f397d6` | accepted | GPU output with explicit `tensor.getData()` readback |
| `670b49fd360015c4cbcd29155d64999562bfb3a9` | failed | queue-upload input path failed at `session.run()` |
| `af245644a1cccf66a8114f62f380e49000ae03f2` | failed | input buffer belonged to a different WebGPU device |
| `46c100eea85ae3a259e2aa0746424445f78d9287` | failed | ONNX Runtime 1.29.0 custom-device synchronization bug |
| `39298f0f4ebea3bd653269ef24120ebeb64c049e` | failed | external device did not request the limits needed by ONNX Runtime 1.30.0 |
| `95b8f98fa870967a5916e8be078b624ec2060579` | accepted | application-owned GPU input buffer on ONNX Runtime 1.30.0 |
| `4ae89872dc10c42d4ac12f75b09e19935f209f24` | control | CPU input on the same ONNX Runtime 1.30.0 setup |
| `9b4cda87f927a4d3aa13134fc460eb61f500a73d` | failed | TypeGPU source texture lacked render usage |
| `4c074dd49b7cc27e6065f97c5fbe47a8c7d33e8e` | failed | TypeGPU JavaScript shader body lacked build-time metadata |
| `fa9f11bf9decc5e4a30a1011ba7fac757519ef1f` | accepted | graph capture and the rewritten WebGPU-compatible model reached the 422 ms warm median |

### GPU input control

The accepted GPU-input candidate had a warm median total of `1,863 ms`. The same-runtime CPU-input control had a warm median of `1,919 ms`.

With three warm runs and visible run-to-run variance, that difference was not enough to claim a meaningful speedup from explicit GPU input by itself. The useful result was that TypeGPU could produce model input in a buffer consumed by ONNX Runtime on the same device.

## Comparison protocol

Use the same source image, browser, device, model, and runtime when making a before-and-after performance claim.

1. Start with a fresh page or process for the cold run.
2. Record model download and session initialization separately from processing time.
3. Run the same image again without reloading for browser warm measurements.
4. Confirm that the warm browser run reused the session and did not fetch the model again.
5. Record each timing stage instead of only the total.
6. Repeat warm runs and compare medians rather than the fastest sample.
7. Confirm output dimensions and matte behavior after every performance change.
8. Record warnings, errors, fallback behavior, and device loss.
9. When the runtime or dependency version changes, establish a control on that same version before attributing a timing change to the code change.

For output-quality comparisons, use the same source images and retain the generated outputs. Prefer numeric alpha-matte metrics when ground-truth mattes are available. Label visual judgments as visual judgments.
