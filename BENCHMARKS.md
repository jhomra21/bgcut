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

## GPU-output experiment

Branch:

`perf/gpu-output-buffer`

Purpose:

- request `preferredOutputLocation: "gpu-buffer"`
- require the returned ORT tensor to report `location === "gpu-buffer"`
- keep all existing preprocessing, model, matte conversion, compositing, and export behavior unchanged
- call `tensor.getData()` only after inference, making the output readback an explicit measured stage
- dispose the ORT-owned GPU tensor after readback

This is intentionally smaller than the eventual TypeGPU pipeline. It answers one question first: how much of the old `session.run()` timing moves into explicit output readback when the model result remains on the GPU?

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

The first GPU-output acceptance should capture at least three warm runs of the same image so we can compare inference and explicit readback separately against a same-image CPU-output baseline.