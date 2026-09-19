# Benchmarks

This file records measured bgcut runtime results and the rules for comparing them.

These numbers belong to specific commits, images, runtimes, and machines. Do not reuse them as general performance claims.

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

See [`graph-capture.md`](graph-capture.md) for the model rewrites and correctness checks behind this result.

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
