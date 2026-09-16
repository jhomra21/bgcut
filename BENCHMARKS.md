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

Change from the CPU-output baseline:

- request `preferredOutputLocation: "gpu-buffer"`
- require the returned ORT tensor to report `location === "gpu-buffer"`
- keep CPU preprocessing, model, matte conversion, compositing, and export behavior unchanged
- call `tensor.getData()` only after `session.run()`
- dispose the ORT-owned GPU tensor after readback

All four timing runs below used the same 1600×1598 cat image without reloading.

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

All warm runs reported a reused session with model fetch and session init at `0.0 ms`.

The accepted browser pass also confirmed unchanged cat fur/ear/whisker behavior, a sensible dog matte, RGBA source-resolution PNG export, SVG rejection, and no WebGPU/Solid/device-crash errors. Only the two known ONNX shape-node CPU-placement warnings appeared.

This experiment proves that explicit GPU output residency works in the accepted runtime and exposes a stable output-readback cost of roughly 102–112 ms for this image. It does **not** prove a speedup versus the CPU-output implementation because the accepted CPU-output warm sample used a different image.

## GPU-input boundary experiment

Branch:

`perf/gpu-input-buffer`

Purpose:

- keep the accepted CPU/Canvas preprocessing math unchanged
- allocate the model input as an app-owned WebGPU buffer on the same device already shared by TypeGPU and ONNX Runtime
- write the existing Float32 NCHW data into that buffer
- wait for the shared queue to finish the upload before starting `session.run()`
- wrap the buffer with `ort.Tensor.fromGpuBuffer()`
- keep the accepted GPU-output path and explicit output readback unchanged
- destroy the app-owned input buffer after the run

The explicit queue synchronization is deliberate. It may add latency, but it moves input upload out of the `Inference` span so the experiment can measure transfer cost honestly before TypeGPU writes model-ready data directly on the GPU.

## Controlled comparison protocol

For before/after performance claims, use the same exact source image and the same browser/device setup.

1. Start from a fresh page/runtime for the cold run.
2. Record every timing stage.
3. Run the same image again without reloading for warm runs.
4. Confirm warm runs report a reused session and zero model/session setup time.
5. Repeat enough times to distinguish stable behavior from one-run noise.
6. Compare medians rather than choosing the fastest run.
7. Confirm output dimensions and visual matte behavior remain unchanged.
8. Record console warnings/errors and any device loss.

For the GPU-input experiment, capture at least three warm runs of the same image and record `Preprocess`, `Input upload`, `Inference`, `GPU readback`, and `Total` separately. The main question is how much work moves out of `session.run()` once both input upload and output readback are explicit boundaries.
