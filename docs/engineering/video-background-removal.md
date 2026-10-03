# Video background removal research

This work is experimental. It does not change bgcut's public browser, CLI, or Node.js API.

## Goal

Find a fully local video segmentation path that can follow a foreground subject through a clip without uploading source frames.

MediaBunny owns demuxing and frame decoding. ONNX Runtime WebGPU owns model inference. The benchmark keeps those layers separate so media decode time, model load time, seed inference, and tracked-frame inference can be measured independently.

## Current candidates

The deployable bake-off now compares:

- **SAM 2.1 Tiny 512 fp16** from Diffusion Studio's pinned temporal ONNX export.
- **EdgeTAM 1024 fp16** from Rotyl's immutable `edgetam-v1` release.

Both are Apache-2.0 model paths and both run through ONNX Runtime WebGPU in the browser.

The EdgeTAM lane is self-contained rather than mixing independently exported artifacts. Its release includes the fp16 vision and prompt decoders, memory attention, memory encoder, tracked-frame decoder, and the learned host parameters required by the memory bank. The benchmark fetches Rotyl's explicit `.gz` release assets through a same-origin test proxy, inflates them, verifies their raw byte lengths, and hands ONNX Runtime the original model filenames.

The earlier `jax-image-tools/edgetam-video-onnx` package remains useful as a reference export, but it is not the deployable EdgeTAM candidate. Its published `constants.json` contains geometry and configuration metadata, not every learned host parameter needed for a faithful standalone tracker.

## Adapter contract

Each candidate implements the same boundary:

1. load model sessions
2. encode and seed a decoded `VideoFrame` from point prompts
3. expose seed alternatives when the model returns them
4. optionally commit a specific seed proposal
5. track later `VideoFrame` objects using temporal memory
6. rewind temporal state
7. close every owned session and resource

The seed prompt has an optional `proposalIndex`. Omitting it uses the model's recommended proposal. Supplying one lets a caller commit a different multimask proposal. This matters for EdgeTAM because a strong mask can exist among its returned proposals even when the model's own IoU ranking chooses another one.

The benchmark seam is deliberately below UI code. A future Solid interface can show proposals and correction controls without owning model state.

## Performance smoke

The Metal acceptance job runs both deployable candidates in headless Chrome on GitHub's Apple-silicon macOS runner.

The smoke uses one seed plus five tracked frames and records:

- reported model size
- model/session load time
- MediaBunny frame decode latency
- seed inference latency
- tracked-frame mean, p50, and p95 inference latency
- tracked inference-only FPS
- model IoU/object-presence outputs
- mask-area and temporal-change diagnostics

Seed time is excluded from `trackedFps`.

The smoke is an execution and warm-latency check, not a quality benchmark.

## DAVIS quality benchmark

Quality is measured separately on labeled DAVIS sequences. The current suite covers:

- `blackswan`
- `bear`
- `camel`
- `cows`
- `bmx-trees`
- `car-shadow`
- `car-turn`

For each sequence the benchmark uses the first 12 frames at 24 fps. It derives a positive seed point from the first ground-truth mask, then compares each predicted mask with the corresponding DAVIS annotation.

The report records:

- seed IoU
- seed boundary F
- all exposed seed alternatives and their ground-truth scores
- mean and minimum tracked IoU
- mean and minimum tracked boundary F
- mean tracked J&F
- tracked inference latency

The boundary score follows the DAVIS-style contour metric with a tolerance based on image diagonal.

### Seed-ranking diagnostic

EdgeTAM is also run in an **oracle seed** diagnostic mode. That mode uses frame-0 ground truth only to choose the best proposal among the masks EdgeTAM already returned for the same user prompt, then runs the normal temporal tracker unchanged.

This is not a deployable automatic selection strategy and must not be reported as product quality. Its purpose is narrower: separate seed-proposal ranking failures from temporal-tracking failures. If the corrected-seed run improves sharply, the product problem is proposal selection/correction. If it does not, the temporal tracker is the limiting factor.

SAM 2.1's current Diffusion export returns one seed mask, so it has no equivalent proposal-selection diagnostic.

### BiRefNet automatic seed

The next product-shaped diagnostic uses bgcut's own pinned BiRefNet model instead of ground truth to decide what foreground means on frame 0. Ground truth is only used afterward to score the result.

For this mode the benchmark:

1. runs the production 512px BiRefNet graph on the first decoded video frame
2. derives one positive point from the predicted foreground matte
3. asks EdgeTAM for its normal multimask proposals at that point
4. chooses the proposal with the highest overlap with the BiRefNet matte
5. commits that proposal to the unchanged EdgeTAM temporal tracker

This is deliberately different from the oracle diagnostic. It is a deployable automatic strategy: the only information used to choose the seed comes from the local models themselves. The first hardware pass is limited to `bmx-trees`, `car-shadow`, and `car-turn`, the three sequences that most clearly expose whether automatic foreground discovery can repair a weak one-point seed without hiding the result behind ground truth.

The experiment uses the same pinned FP32 BiRefNet artifact Chrome uses in bgcut's normal WebGPU path. It is intentionally not a new model or a special video checkpoint.

The first hardware pass exposed two different cases. On `car-shadow`, BiRefNet produced a 0.981-IoU frame-0 matte, selected Edge proposal 0 with 0.971 overlap, and the tracker reached 0.979 mean tracked IoU. That is effectively the same result as the ground-truth oracle without using ground truth to choose the seed.

On `bmx-trees` and `car-turn`, the production 0.5 BiRefNet threshold produced no foreground pixels. Treating that as a fatal error threw away useful relative model confidence. The follow-up keeps the normal binary-matte behavior whenever any pixel is above 0.5. Only when none are does it use the maximum-logit pixel as the positive prompt and rank Edge proposals with soft BiRefNet probability IoU. The report records the maximum logit, positive-pixel fraction, fallback use, and ranking metric so this behavior stays visible.

## Memory ownership

The two trackers have different host-side memory contracts and should not be forced into one tensor layout.

### EdgeTAM

The EdgeTAM host:

- removes the vision encoder's learned no-memory embedding before tracked memory attention
- keeps the user-conditioned anchor memory for the whole track
- keeps up to six recent spatial memories beside the anchor
- builds the fixed seven-entry memory tensor plus object-pointer block
- applies the learned temporal position table to spatial memory
- leaves pointer temporal positions at zero for this checkpoint
- uses the tracked-frame decoder that exposes `object_pointer`
- substitutes the learned no-object pointer on absent frames
- does not train the memory bank on a normal predicted mask when the model says the object is absent

### SAM 2.1

The SAM lane follows the Diffusion temporal export contract, including its no-memory feature, temporal memory positions, pointer-position graph, object pointer, and memory encoder.

The benchmark treats these as model-specific adapter details. The runner only sees decoded frames and masks.

## Model delivery

Research model sources are pinned. The benchmark does not depend on mutable model-repository `main` branches.

Before any video path can ship as part of bgcut, the selected assets need the same release discipline as the existing image model:

- immutable versioned model manifest
- byte length and SHA-256 for every artifact
- same-origin delivery
- cache validation
- documented upstream revisions and licenses
- browser compatibility checks
- failure behavior for unsupported WebGPU environments

## Player and preview

MediaBunny remains the media layer. Its player example is a behavior reference for playback timing, iterator cancellation, seeking, audio-clock synchronization, volume, fullscreen, and decoded-frame pooling.

Preview and tracking should share decoded-media infrastructure but not one mutable playback loop. Tracking must be free to run faster or slower than realtime without fighting the user's preview playhead.

## References used

- Diffusion Studio `packages/sam2`: working SAM 2.1 temporal tracking with MediaBunny and ONNX Runtime WebGPU.
- Diffusion Studio object-mask UI: prompt and correction workflow.
- Rotyl EdgeTAM release and tracker: complete EdgeTAM graph/parameter ownership and validated host-side memory arithmetic.
- MediaBunny media-player example: local playback and seek behavior.
- gpuix-solid MediaBunny work: future native VideoToolbox and decoded-frame presentation path.

Reference implementations are used to verify behavior, graph contracts, and ownership. bgcut keeps its own benchmark and product boundaries.
