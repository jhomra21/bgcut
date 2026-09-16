# Benchmarks

This file records measured performance baselines and controlled comparison rules for `removebg-webgpu`.

Do not use these numbers as general product claims. They are exact-run observations from a particular browser, device, image, model revision, and commit.

## Accepted CPU-output baseline

Accepted exact SHA:

`8567c5294cfa88a27c08bf55bed40c7d5dd68b07`

Model:

- `studioludens/birefnet-lite-512`
- revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`
- fp32 ONNX model
- 512×512 inference input
- ONNX Runtime Web 1.29.0 WebGPU EP
- session output location: CPU

Manual acceptance also confirmed unchanged matte quality, source-resolution PNG export, session reuse, SVG rejection, and no WebGPU/Solid/device-crash errors.

### Observed timings

| Stage | Cold cat | Warm dog |
| --- | ---: | ---: |
| Total | 16,599 ms | 1,837 ms |
| Decode | 14 ms | 14 ms |
| Runtime | 0.0 ms | 0.1 ms |
| Model fetch | 12,157 ms | 0.0 ms |
| Session init | 1,785 ms | 0.0 ms |
| Preprocess | 39 ms | 11 ms |
| Inference | 2,505 ms | 1,788 ms |
| Output access | 0.2 ms | 0.0 ms |
| Matte | 12 ms | 4.5 ms |
| Composite | 1.9 ms | 0.2 ms |
| PNG export | 82 ms | 19 ms |

The cold and warm rows used different source images, so they are not a controlled cold-vs-warm speed comparison.

The warm dog result shows that the measured `session.run()` span dominates that run. With CPU output requested, that span may include hidden device-to-host transfer performed by ONNX Runtime, so it must not be interpreted as pure model compute time.

## Accepted GPU-output boundary

Accepted exact SHA:

`4a2e07de544433ad2b321cb4e29be28a74f397d6`

The same 1600×1598 cat image was used for one cold run plus three warm reruns without reloading.

| Metric | Cold | Warm 1 | Warm 2 | Warm 3 | Warm median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Total | 11,807 ms | 1,759 ms | 1,264 ms | 1,172 ms | 1,264 ms |
| Preprocess | 85 ms | 7.4 ms | 5.8 ms | 7.0 ms | 7.0 ms |
| Inference | 1,372 ms | 1,567 ms | 1,086 ms | 977 ms | 1,086 ms |
| GPU readback | 106 ms | 111 ms | 102 ms | 112 ms | 111 ms |
| Matte | 33 ms | 3.2 ms | 2.4 ms | 3.7 ms | 3.2 ms |
| Composite | 6.9 ms | 0.1 ms | 0.1 ms | 0.0 ms | 0.1 ms |
| PNG export | 77 ms | 55 ms | 53 ms | 58 ms | 55 ms |

Cold setup:

- model fetch: 8,468 ms
- session init: 1,643 ms
- reported `cold session`

The accepted browser runtime proved that `preferredOutputLocation: "gpu-buffer"` worked for BiRefNet and made output readback an explicit `tensor.getData()` stage. These measurements do not prove a speedup versus the earlier CPU-output baseline because the earlier baseline used a different image.

## Failed explicit-input candidate

Exact SHA:

`670b49fd360015c4cbcd29155d64999562bfb3a9`

This candidate created an app-owned WebGPU input buffer, populated it with `GPUQueue.writeBuffer()`, waited for `queue.onSubmittedWorkDone()`, and passed the result through `Tensor.fromGpuBuffer()`.

Exact-head browser acceptance failed reproducibly for both the accepted cat and dog images at `session.run()`. All five startup checks remained green, SVG rejection remained correct, there were no device-loss or uncaught errors, and only the two known ONNX shape-node CPU-placement warnings appeared. No valid timing result was produced.

Because ONNX Runtime 1.29.0's own WebGPU IO-binding test stages GPU input differently—using a buffer mapped at creation, a CPU byte copy into the mapped range, then `unmap()` before `Tensor.fromGpuBuffer()`—the next candidate mirrors that upstream-tested path. Upstream also notes that this staging path does not provide a separately awaitable copy-completion boundary, so its timing must not be described as completed host-to-device upload time.

## GPU-input staging experiment

Branch:

`perf/gpu-input-buffer`

Current direction:

- keep accepted CPU/Canvas preprocessing unchanged
- create the model input GPU buffer with `mappedAtCreation: true`
- copy the existing Float32 NCHW bytes into the mapped range
- unmap before `Tensor.fromGpuBuffer()`
- preserve the accepted GPU-output / explicit readback path
- explicitly dispose the wrapper tensor and destroy the app-owned GPU input buffer
- preserve the underlying ONNX Runtime error text if `session.run()` rejects

The current timing field is still named `inputUploadMs` for compatibility with the existing instrumentation contract, but on this staging path it measures buffer creation + mapped CPU copy + unmap. It does not prove completion of host-to-device transfer.

## Controlled comparison protocol

For before/after performance claims, use the same exact source image and the same browser/device setup.

1. Start from a fresh page/runtime for the cold run.
2. Record every timing stage.
3. Run the same image again without reloading for the warm run.
4. Confirm the second run reports a reused session and zero model/session setup time.
5. Repeat enough times to distinguish stable behavior from one-run noise.
6. Compare medians rather than choosing the fastest run.
7. Confirm output dimensions and visual matte behavior remain unchanged.
8. Record console warnings/errors and any device loss.
