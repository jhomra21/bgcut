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

## GPU-input staging experiment

Branch:

`perf/gpu-input-buffer`

Current runtime:

- ONNX Runtime Web 1.30.0

Current direction:

- keep accepted CPU/Canvas preprocessing unchanged
- request the application-owned WebGPU device with the same compute/storage limits ONNX Runtime 1.30 requests by default
- request the same available ORT WebGPU features: Chromium timestamp-query-inside-passes or standard timestamp-query fallback, `shader-f16`, and `subgroups`
- initialize TypeGPU from that device
- pass the same device to ONNX Runtime per session via `executionProviders: [{ name: "webgpu", device }]`
- create the model input GPU buffer on that same device
- stage the existing Float32 NCHW bytes with `mappedAtCreation`, mapped CPU copy, and `unmap()`
- preserve the accepted GPU-output / explicit readback path
- explicitly dispose the wrapper tensor and destroy the app-owned GPU input buffer
- preserve the underlying ONNX Runtime error text if session creation or `session.run()` rejects

The current timing field is still named `inputUploadMs` for instrumentation compatibility, but the UI labels it `Input staging`. On this path it measures buffer creation + mapped CPU copy + unmap. It does not prove completion of host-to-device transfer.

Because this experiment now uses ONNX Runtime Web 1.30.0 while the accepted PR #3 comparison point used 1.29.0, latency differences between them cannot be attributed solely to explicit GPU input. Correctness and device interoperability can be accepted directly; a performance attribution requires a 1.30.0 control using the prior CPU-input/GPU-output path.

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