# Video background removal research

This work is experimental. It does not change the public bgcut browser, CLI, or Node.js contract.

## Goal

Find a local video segmentation path that can follow one foreground subject through a clip without uploading source frames. MediaBunny owns container parsing and frame decoding. ONNX Runtime WebGPU owns model inference. A later bgcut UI can use Solid without putting model or decoder state in components.

The first bake-off compares two full temporal models:

- SAM 2.1 Tiny through `jax-image-tools/sam21-tiny-video-onnx`
- EdgeTAM through `jax-image-tools/edgetam-video-onnx`

Both exports use 1024 x 1024 model input and the same four ONNX graph roles: vision encoder, mask decoder, memory attention, and memory encoder. Both leave the temporal memory bank in JavaScript. That makes this the cleanest first comparison because the export shape does not favor one model.

The model repositories are research inputs, not release artifacts. Their current `main` files must be pinned by revision, byte size, and SHA-256 before any bgcut release can depend on them.

## Why there are two rounds

The first round answers which model architecture is a better tracker under the same export conditions.

If SAM 2.1 Tiny remains competitive, a second round will test Diffusion Studio's 512 px fp16 SAM 2.1 Tiny export. That export is much smaller than the 1024 fp32-style comparison artifact and is closer to bgcut's current 512 px image pipeline. Mixing it into round one would make model architecture and export optimization impossible to separate.

## Benchmark seam

Each model adapter has the same small interface:

1. load
2. seed one decoded `VideoFrame` with point prompts
3. track later `VideoFrame` objects
4. rewind when backward tracking is added
5. close every session and GPU resource it owns

The benchmark runner does not know ONNX tensor names or memory-bank rules. The adapter does not know how the file was demuxed.

MediaBunny provides the frame-source adapter. The benchmark asks it for the same timestamps for both candidates.

## Measurements

Every run records:

- reported model download size
- model/session load time
- decoded frame count
- decode latency per requested frame
- seed and tracked inference latency
- p50 and p95 inference latency
- inference-only tracked FPS
- model IoU/object-presence values when the graph provides them
- foreground area per frame
- binary IoU against the previous tracked mask as a simple temporal-change signal

The last metric is not a quality score. A moving subject should change its mask. It is useful only beside the same clip, timestamps, and prompt.

Quality gates need labeled clips. The next stage will add short fixtures that cover a person, hair or thin edges, fast motion, partial occlusion, full occlusion and re-entry, and a similarly colored foreground/background. Candidate masks will be compared with the same reference mattes.

## Player and preview

MediaBunny remains the media layer. Its player example is a behavior reference for playback timing, iterator cancellation, seeking, audio-clock synchronization, volume, fullscreen, and decoded-frame pooling. bgcut will implement its own Solid controls and state.

Preview and tracking should share decoded media infrastructure but not one mutable playback loop. Tracking must be able to run faster or slower than realtime without fighting the user's preview playhead.

## References used

- Diffusion Studio `packages/sam2`: working SAM 2.1 video tracking with MediaBunny and ONNX Runtime WebGPU.
- Diffusion Studio object-mask UI: Solid prompt and correction workflow.
- MediaBunny media-player example: local playback and seek behavior.
- WebSAM EdgeTAM video engine: memory-bank ownership, backpressure, cancellation, and frame-stream design.
- gpuix-solid MediaBunny work: future native VideoToolbox and decoded-frame presentation path.

Reference implementations are studied for behavior and ownership. bgcut reimplements what it needs rather than copying source.
