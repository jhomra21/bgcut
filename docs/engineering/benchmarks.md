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

### Candidate-model isolation

After a cross-tool run finds a promising model, test that exact ONNX file through bgcut before proposing a product profile. This separates model quality from the competitor's runtime and postprocessing.

```sh
bun run benchmark:model-candidate -- \
  /path/to/manifest.json \
  ./tmp/bench/general-lite-webgpu-rembg \
  /path/to/birefnet-general-lite.onnx \
  1024 \
  gpu \
  5 \
  rembg

bun run benchmark:score -- \
  /path/to/manifest.json \
  ./tmp/bench/general-lite-webgpu-rembg
```

The final argument chooses the preprocessing and mask pipeline:

- `rembg`: Lanczos model-input resize, rembg's max-value normalization followed by ImageNet mean/std, sigmoid, per-image min/max mask normalization, then Lanczos mask resize.
- `bgcut`: bgcut's linear model-input resize with ImageNet normalization, direct sigmoid-to-alpha conversion, then cubic mask resize.

The `rembg` mode mirrors the algorithmic choices in rembg's General-family session. Sharp and Pillow have separate Lanczos implementations, so it is not expected to be byte-identical to rembg.

Run both modes before changing the public API. If the raw candidate cannot create a WebGPU session, keep the failure output: it identifies the next model-rewrite experiment instead of silently falling back to CPU.

For BiRefNet General Lite, use a 1024 input. rembg's current General-family session preprocesses with ImageNet mean/std at 1024x1024 and applies sigmoid plus min/max normalization before resizing the mask to the source image.

### 2026-09-22 General Lite candidate

PR #93 tested two ways to improve the six-image binary-mask benchmark without changing the default product path.

First, rembg-style preprocessing and mask handling were applied to bgcut's existing 512x512 model. That variant was slower and slightly worse overall.

| Pipeline | Warm median | Pooled alpha MAE | Pooled IoU |
| --- | ---: | ---: | ---: |
| bgcut 512 WebGPU | 448.8 ms | 0.02210 | 0.96476 |
| bgcut 512 with rembg-style processing | 501.4 ms | 0.02319 | 0.96312 |

The processing-only variant improved Amelia from `0.881` to `0.893` IoU and Yoda kitten from `0.969` to `0.970`, but Molly fell from `0.696` to `0.678`. It is not a product candidate.

The second experiment used rembg's BiRefNet General Lite model at 1024x1024. The original model has SHA-256 `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333` and size `224,005,088` bytes.

The raw model created an ONNX Runtime 1.30.0 WebGPU session, then failed at `/decoder/Split_33`. The Split shader needed eleven storage buffers while the M3 Pro device limit was ten. ONNX Runtime's native WebGPU Split implementation binds one storage buffer for the input and one for each non-empty output.

The benchmark rewrite replaced 50 wide Split nodes, `/decoder/Split` through `/decoder/Split_49`, with equivalent Slice nodes. The rewritten model has SHA-256 `12b606d8170f0ab4aff57b44df8127c5d4cc046628596a7eb5e39459b06fe3d3` and size `224,371,603` bytes.

The rewrite passed the deterministic CPU equivalence gate exactly. The original and rewritten models produced 1,048,576 output values with zero differences. Maximum and mean absolute difference were both `0`.

Both rewritten-model WebGPU benchmark modes then completed all six images.

| Run | Warm median across image medians | Pooled IoU | Alpha MAE | F1 |
| --- | ---: | ---: | ---: | ---: |
| Current bgcut 512 WebGPU | 448.75 ms | 0.964762 | 0.022099 | 0.982065 |
| General Lite original rembg CPU reference | 7.19 s | 0.977479 | 0.016113 | 0.988611 |
| General Lite rewritten WebGPU + rembg processing | 6.73 s | 0.969981 | 0.018650 | 0.984762 |
| General Lite rewritten WebGPU + bgcut processing | 6.76 s | 0.977448 | 0.014031 | 0.988595 |

The 1024 model with bgcut processing produced the strongest candidate result. Molly improved from `0.696216` IoU on the current 512 model to `0.864092`. The aggregate IoU nearly matched the original rembg CPU result, and aggregate alpha MAE was lower on this set.

The current 512 model remains the default. The 1024 candidate is about 15 times slower in the native WebGPU benchmark and is only a possible opt-in quality profile.

The native candidate runner does not measure the browser production path. It uses `onnxruntime-node`, while bgcut's browser path uses ONNX Runtime Web graph capture plus persistent GPU input and output buffers. ONNX Runtime documents JavaScript `enableGraphCapture` as Web-only for the WebGPU execution provider. A browser benchmark is required before using the 6.7-second native result as the expected latency of a browser quality profile.

ONNX Runtime printed a provider-placement notice for some shape-related nodes during the successful 1024 runs. No WebGPU kernel failed after the Split rewrite.

These quality numbers use six binary segmentation masks. They do not measure soft fur or hair alpha, translucency, or edge-color cleanup. A quality-profile decision still needs visual inspection and a soft-alpha reference set.

The next timing check is the browser graph-capture path. The preferred command is the E2E runner, which starts the local server, launches a fresh Chrome profile itself, waits for the page to finish, saves logs, and shuts everything down. It does not require browser-panel automation.

```sh
bun run benchmark:browser-candidate:e2e -- \
  /path/to/manifest.json \
  /path/to/browser-output \
  /path/to/birefnet-general-lite-webgpu.onnx \
  1024 \
  5
```

The E2E run writes source-resolution PNGs, `browser-timings.json`, `quality.json`, and browser/server stdout and stderr logs to the output directory. It removes any stale timing, quality, or failure report before starting. If the page fails, it writes `browser-failure.json` and the command exits with that failure instead of waiting for a manual tab.

Chromium-family browsers are preferred and launched with an isolated profile. The launcher checks Chrome, Edge, Brave, Chromium, Arc, Vivaldi, and Opera in common macOS and Linux locations. Set `BGCUT_BROWSER_PATH` to an explicit Chromium executable when needed; `BGCUT_CHROME_PATH` remains accepted for compatibility.

On macOS, Safari Technology Preview and then Safari are experimental fallbacks when no Chromium-family browser is installed. They are launched through macOS `open`, so the harness cannot manage a disposable Safari profile or track the browser process itself. The page still reports runtime failures back to `browser-failure.json`, and the server remains the completion boundary.

Set `BGCUT_BROWSER_BENCHMARK_TIMEOUT_MS` to change the default 15-minute timeout.

The manual server remains available for debugging:

```sh
bun run benchmark:browser-candidate -- \
  /path/to/manifest.json \
  /path/to/browser-output \
  /path/to/birefnet-general-lite-webgpu.onnx \
  1024 \
  5
```

The browser runner enables ONNX Runtime Web graph capture and keeps the model input and output in fixed WebGPU buffers across runs. It repeats the browser pipeline for each image, including image decode, GPU preprocessing, output readback, matte construction, source-resolution compositing, and PNG export. Model fetch time and session creation are reported separately.

This test is necessary because `onnxruntime-node` does not expose the JavaScript WebGPU graph-capture option used by bgcut's browser runtime. The native 6.7-second result is therefore not the expected browser latency for a possible quality profile.

The rewrite command and deterministic equivalence gate remain available for future model candidates:

```sh
bun run model:rewrite-webgpu-splits -- \
  /path/to/birefnet-general-lite.onnx \
  /path/to/birefnet-general-lite-webgpu.onnx \
  --max-storage-buffers-per-stage 10

bun run benchmark:model-equivalence -- \
  /path/to/birefnet-general-lite.onnx \
  /path/to/birefnet-general-lite-webgpu.onnx \
  1024 \
  ./tmp/general-lite-equivalence.json
```

See [ONNX Runtime's WebGPU Split implementation](https://github.com/microsoft/onnxruntime/blob/main/onnxruntime/core/providers/webgpu/tensor/split.cc) for the storage-buffer behavior behind the rewrite.
### Published reference numbers

These numbers are context only. They were not collected on the same hardware or with the same model, input, output path, or timing boundaries.

| Tool | Environment | Reported number | Boundary |
| --- | --- | --- | --- |
| bgcut | Apple M3 Pro, current accepted browser fast path | 422 ms warm median | Full browser removal from decoded source through source-resolution PNG export |
| IMG.LY background-removal-js | Apple M3 Max, June 2024 WebGPU fp16 benchmark | about 100 ms on consecutive runs; about 300 ms for the first neural-network run | ONNX model initialization and neural-network execution, with model download discussed separately |

The IMG.LY post is useful as a WebGPU reference, but it is not evidence that either tool is faster. bgcut's current WebGPU timing also records `session.run()` submission separately from the later output-buffer synchronization, so the small submit span is not a GPU execution measurement.

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

## Current accepted browser fast path

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
