# Benchmarks

This file records measured performance baselines and controlled comparison rules for `removebg-webgpu`.

Do not use these numbers as general product claims. They are exact-run observations from a particular browser, device, image, model revision, runtime version, and commit.

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

Runtime:

- ONNX Runtime Web 1.29.0

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

## Failed explicit-input candidate: queue upload

Exact SHA:

`670b49fd360015c4cbcd29155d64999562bfb3a9`

Runtime:

- ONNX Runtime Web 1.29.0

This candidate created an app-owned WebGPU input buffer, populated it with `GPUQueue.writeBuffer()`, waited for `queue.onSubmittedWorkDone()`, and passed the result through `Tensor.fromGpuBuffer()`.

Exact-head browser acceptance failed reproducibly for both the accepted cat and dog images at `session.run()`. All five startup checks remained green, SVG rejection remained correct, there were no device-loss or uncaught errors, and only the two known ONNX shape-node CPU-placement warnings appeared. No valid timing result was produced.

Because ONNX Runtime 1.29.0's own WebGPU IO-binding test stages GPU input differently—using a buffer mapped at creation, a CPU byte copy into the mapped range, then `unmap()` before `Tensor.fromGpuBuffer()`—the next candidate mirrored that upstream-tested path. Upstream also notes that this staging path does not provide a separately awaitable copy-completion boundary, so its timing must not be described as completed host-to-device upload time.

## Failed explicit-input candidate: upstream staging on the wrong device

Exact SHA:

`af245644a1cccf66a8114f62f380e49000ae03f2`

Runtime:

- ONNX Runtime Web 1.29.0

This candidate mirrored ONNX Runtime 1.29.0's own input staging sequence with `mappedAtCreation`, CPU byte copy, `unmap()`, and `Tensor.fromGpuBuffer()`.

The cat cold run, all three cat warm retries, and the dog regression all failed identically. The preserved ONNX Runtime error was:

```text
WebGPU validation failed.
[Buffer] is associated with [Device], and cannot be used with [Device].
... BindGroupDescriptor "Transpose"
```

The five startup checks were still green, which proved the old `ort.env.webgpu.device === appDevice` check did not establish that the WebGPU execution provider would actually use that device. ONNX Runtime 1.29.0 treats `env.webgpu.device` as an output/default-device surface; custom devices belong in the per-session WebGPU execution-provider options.

No timing, matte, export dimensions, or session-reuse result from this candidate is valid.

## Failed explicit-input candidate: custom device on ONNX Runtime 1.29.0

Exact SHA:

`46c100eea85ae3a259e2aa0746424445f78d9287`

Runtime:

- ONNX Runtime Web 1.29.0

This candidate passed the application-owned `GPUDevice` through ONNX Runtime's supported per-session WebGPU execution-provider option:

```ts
executionProviders: [{ name: "webgpu", device }]
```

That removed the previous cross-device buffer validation failure, but session creation then failed reproducibly for the cat cold run, all three cat retries, and the dog regression with:

```text
Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: Failed to wait for the operation:3
```

SVG rejection remained correct, startup diagnostics remained green, no uncaught exception or device-loss event appeared, and only the expected ONNX shape-node CPU-placement warnings were present. No timing, matte, export dimensions, or session-reuse result from this candidate is valid.

This error matches ONNX Runtime issue #32257 for user-provided `GPUDevice` synchronization. The fix landed in ONNX Runtime PR #32259 and is included in ONNX Runtime 1.30.0. The experiment therefore upgrades to 1.30.0 rather than adding a local workaround around the 1.29.0 synchronization bug.

## Failed explicit-input candidate: ORT 1.30 with default device limits

Exact SHA:

`39298f0f4ebea3bd653269ef24120ebeb64c049e`

Runtime:

- ONNX Runtime Web 1.30.0

This candidate successfully created the ORT custom-device session and reached `OrtRun()`. The previous cross-device validation error and `Failed to wait for the operation:3` synchronization error were both gone.

Inference then failed reproducibly for the cat and dog while creating ORT's `Conv2dMM` WebGPU compute pipeline:

```text
Failed to create a WebGPU compute pipeline:
[Invalid ShaderModule "Conv2dMM"]
```

A second warm cat attempt made the browser tab unresponsive, so no timing, matte, export dimensions, or session-reuse result from this candidate is valid.

The application had created its external device with plain `adapter.requestDevice()`. ONNX Runtime 1.30's own WebGPU initialization instead requests the adapter's compute/storage limits and available WebGPU features before compiling its shader programs. Upstream also documents that ORT cannot add features or raise limits on an external device after it has been created; the application is responsible for requesting the required capabilities.

The next candidate therefore mirrors ONNX Runtime 1.30's device descriptor rather than treating a default WebGPU device as ORT-compatible.

## Accepted GPU-input boundary

Accepted exact SHA:

`95b8f98fa870967a5916e8be078b624ec2060579`

Merged main SHA:

`b83085a8d0e580c2761ddb291d1bdd9f43547315`

Runtime:

- ONNX Runtime Web 1.30.0
- app-owned ORT-compatible shared `GPUDevice`
- CPU/Canvas preprocessing
- mapped app-owned GPU input buffer passed through `Tensor.fromGpuBuffer()`
- GPU-buffer output with explicit `tensor.getData()` readback

The same 1600×1598 cat image was used for one cold run plus three warm reruns without reloading.

| Metric | Cold | Warm 1 | Warm 2 | Warm 3 | Warm median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Total | 12,862 ms | 1,905 ms | 1,776 ms | 1,863 ms | 1,863 ms |
| Preprocess | 31 ms | 12 ms | 7.0 ms | 6.3 ms | 7.0 ms |
| Input staging | 0.2 ms | 0.5 ms | 1.5 ms | 1.6 ms | 1.5 ms |
| Inference | 2,932 ms | 1,713 ms | 1,613 ms | 1,672 ms | 1,672 ms |
| GPU readback | 136 ms | 101 ms | 80 ms | 106 ms | 101 ms |
| Matte | 4.5 ms | 3.7 ms | 2.7 ms | 4.1 ms | 3.7 ms |
| Composite | 0.8 ms | 0.2 ms | 0.1 ms | 0.3 ms | 0.2 ms |
| PNG export | 62 ms | 62 ms | 58 ms | 58 ms | 58 ms |

Cold setup:

- model fetch: 7,875 ms
- session init: 1,805 ms

Acceptance confirmed `Conv2dMM` compiled, cat fur/ears/whiskers were retained, RGBA 1600×1598 cat export, sensible RGBA 1200×800 dog output, unchanged SVG rejection, session reuse, no cross-device/wait errors, and no uncaught exception or device crash.

`Input staging` measures mapped buffer creation + CPU copy + unmap. It does not prove completion of host-to-device transfer.

## ORT 1.30 CPU-input control

Control exact SHA:

`4ae89872dc10c42d4ac12f75b09e19935f209f24`

This benchmark-only control kept the accepted ORT 1.30 runtime, ORT-compatible shared device, BiRefNet revision, CPU/Canvas preprocessing, GPU output, explicit readback, matte, composite, export, and session reuse unchanged. It changed only the model input from the app-owned GPU buffer to a normal CPU-backed `ort.Tensor`.

| Metric | Cold | Warm 1 | Warm 2 | Warm 3 | Warm median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Total | 11,875 ms | 1,919 ms | 2,004 ms | 1,764 ms | 1,919 ms |
| Preprocess | 34 ms | 6.7 ms | 8.2 ms | 12 ms | 8.2 ms |
| Input staging | 0.1 ms | 0.1 ms | 0.0 ms | 0.0 ms | 0.0 ms |
| Inference | 1,670 ms | 1,700 ms | 1,736 ms | 1,577 ms | 1,700 ms |
| GPU readback | 80 ms | 131 ms | 173 ms | 94 ms | 131 ms |
| Matte | 4.6 ms | 4.1 ms | 2.8 ms | 4.6 ms | 4.1 ms |
| Composite | 0.3 ms | 0.2 ms | 0.2 ms | 0.1 ms | 0.2 ms |
| PNG export | 58 ms | 63 ms | 65 ms | 61 ms | 63 ms |

Cold setup:

- model fetch: 8,315 ms
- session init: 1,698 ms

Warm model fetch and session init were `0.0 ms` for all three reruns. Correctness also passed: transparent cat matte with retained fur, RGBA PNG 1600×1598/color type 6, runtime checks green, expected ORT warnings only, and no exception or device crash.

### Same-runtime interpretation

Against the accepted GPU-input candidate, the CPU-input control warm median was:

- `56 ms` slower in total: `1,919 ms` vs `1,863 ms`
- about `26.6 ms` slower across input staging + inference: `1,700.0 ms` vs `1,673.5 ms`

With only three warm runs and noticeable run-to-run variance, this is not evidence of a meaningful speedup from explicit GPU input. Treat the standalone external GPU-input boundary as **performance-neutral at this sample size**. Its value is architectural: it gives TypeGPU a supported path to write model-ready data into the same GPU buffer that ONNX Runtime consumes, which is a prerequisite for removing the CPU preprocessing/staging boundary in later experiments.

## Controlled comparison protocol

For before/after performance claims, use the same exact source image, browser/device setup, and runtime version.

1. Start from a fresh page/runtime for the cold run.
2. Record every timing stage.
3. Run the same image again without reloading for the warm run.
4. Confirm the second run reports a reused session and zero model/session setup time.
5. Repeat enough times to distinguish stable behavior from one-run noise.
6. Compare medians rather than choosing the fastest run.
7. Confirm output dimensions and visual matte behavior remain unchanged.
8. Record console warnings/errors and any device loss.
9. When a dependency/runtime version changes, establish a control on that same version before attributing a latency delta to a pipeline change.
