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

Quality is measured separately on labeled DAVIS sequences. The original development suite contains seven clips chosen to exercise the two model families and seed-ranking failures. The current holdout is the official 30-sequence DAVIS 2017 validation split.

For each sequence the benchmark uses the first 12 frames at 24 fps. Diagnostic known-point modes derive a positive seed point from the first ground-truth mask. Automatic `grid-model` does not: it selects from EdgeTAM's own 7×7 point-grid candidates, and the DAVIS annotation is read only afterward for scoring.

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

On `bmx-trees` and `car-turn`, the production 0.5 BiRefNet threshold produced no foreground pixels. A follow-up retained relative confidence by using the maximum-logit pixel and soft-probability overlap. That did not rescue either clip. Their maximum logits were about -10, meaning BiRefNet was confidently predicting background everywhere rather than merely missing the 0.5 cutoff. On `car-turn` the soft-overlap fallback selected proposal 2 even though proposal 0 was the strong object mask. That fallback is therefore diagnostic evidence, not a product strategy.

### Automatic point-grid discovery

The next diagnostic removes BiRefNet from the hard cases. EdgeTAM encodes frame 0 once, then evaluates a 4×4 grid of positive point prompts and keeps all three masks returned at every point. For every candidate the report records:

- prompt point
- proposal index
- model IoU estimate
- stability under ±1 logit thresholds
- foreground area fraction
- ground-truth IoU, boundary F, and J&F

Ground truth chooses the best candidate only for this diagnostic. The purpose is to answer one question before inventing a selector: does an automatic EdgeTAM point grid contain the correct foreground mask at all? If it does, automatic video background removal becomes a ranking problem. If it does not, denser sampling or a different foreground-discovery model is required.

The 4×4 pass found the `car-shadow` subject cleanly: its best grid seed reached 0.947 IoU and the unchanged tracker reached 0.978 mean tracked IoU. It did not cover the other two targets closely enough. `bmx-trees` peaked at 0.152 seed IoU, while `car-turn` had no overlapping seed candidate. Their known diagnostic seed points sit near (0.537, 0.520) and (0.879, 0.539), respectively; the 4×4 cell centers were too coarse.

The follow-up uses a 7×7 uniform grid. It also records mask bounding-box geometry, centroid, frame-edge contact, edge-pixel fraction, and a compact 32×32 binary fingerprint for every candidate. Those fingerprints let the artifact be clustered offline by mask overlap, so a deployable ranking rule can be derived from model-only agreement rather than another ground-truth-tuned score.

The 7×7 grid contains a useful subject mask on all three hard sequences. `car-shadow` reaches 0.970 seed IoU and 0.979 mean tracked IoU. `car-turn` reaches 0.883 seed IoU and 0.955 mean tracked IoU. On `bmx-trees`, the grid contains a proposal-0 mask at (0.5, 0.5) with 0.447 seed IoU, essentially matching the known-point oracle's 0.452.

The candidate fingerprints show that simple consensus is not enough: large background regions recur at many prompt points and dominate overlap clusters. A smaller model-only rule works on all three hard cases without ground truth:

1. consider only proposal 0
2. reject masks whose foreground touches the image frame
3. choose the remaining mask with the highest stability score

This selects the useful subject candidate on all three hard sequences. The frozen `grid-model` rule was then evaluated across the seven-sequence development set. It selected a usable foreground on all seven without consulting ground truth. Mean tracked IoU was 0.866 and mean tracked J&F was 0.869. On the same seven clips, the known-point Edge oracle averaged 0.863 tracked IoU, the original Edge model-ranked seed averaged 0.583, and SAM 2.1 Tiny averaged 0.721. The four clips not used to derive the selector also remained strong: blackswan 0.789, bear 0.961, camel 0.971, and cows 0.960 mean tracked IoU.

Those seven clips are not enough to call the selector general. The next holdout uses the official DAVIS 2017 validation split: all 30 sequences from `ImageSets/2017/val.txt`, with the first 12 indexed annotation PNGs served directly from the official 480p train/val archive. The archive is verified against SHA-256 `e3d0b5b77c3d031b000a19e0e25e3e2cac65d183755601bc2cf066df1a2aa492` before use. This matters because DAVIS 2017 validation includes multi-object clips; the current automatic path commits one mask, so this holdout should expose whether single-subject discovery must become multi-object union before productization.

The oracle proposal runs also exposed a separate result: for all seven current DAVIS sequences, the best mask among the three masks returned at the known subject point was proposal 0. EdgeTAM's predicted-IoU ranking was the source of the catastrophic `car-shadow` and `car-turn` seed choices. This makes proposal 0 a strong ranking control once a subject point is already known, but it does not by itself solve automatic subject discovery.

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
