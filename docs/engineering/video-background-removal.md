# Video background removal research

This work is experimental. It does not change bgcut's public browser, CLI, or Node.js API.

## Checkpoint handoff - 2026-10-07

The accepted code baseline is `5cbb0dc04a81b3eaad93640323baa72b588a4beb`.
On that exact head, `bun run check`, the Cloudflare dry run/runtime smoke, the
lower-level Chromium video acceptance, the performance harness, and the actual Solid
video-editor acceptance all passed. The Solid gate runs in macOS CI and exercises the
single intake, real SAM click/refinement flow, retained masks during queued refinements,
desktop and 390 px mobile layout, the initial-viewport primary action, a real export,
and switching back to the image path.

The performance work now has measured limits rather than an output-rate claim. A
generated 60 fps source is exported with 60 distinct timestamps, but full-cadence SAM
tracking processed that one-second fixture at about 1.92 output frames/s and 2.05
tracked frames/s on the accepted runner. Output cadence and inference throughput are
therefore separate: bgcut can preserve a 60 fps timeline, but it does not infer at
60 fps.

The selected subject frame is reused when an interactive export starts at that same
frame, so export no longer decodes and vision-encodes a frame the editor already owns.
In the run before this optimization, the full-cadence seed stage was about 1.79 s on
`bear` and 1.51 s on `bmx-trees`; on the accepted head it was about 0.91 s and
0.81 s. Bear quality was unchanged at 0.950 mean DAVIS IoU and 0.957 mean boundary F.

Several tempting shortcuts were measured and rejected:

- A fixed sparse tracking cadence is not the product default. Twelve tracked frames/s
  stayed close to full cadence on bear, but `bmx-trees` diverged sharply between
  tracked frames.
- Linear alpha interpolation improved bear's sparse masks but did not repair the hard
  `bmx-trees` trajectory, so the experiment was removed.
- Keeping only selected SAM outputs in WebGPU buffers produced identical quality but
  no throughput gain in the same-click benchmark (about 2.79 tracked frames/s normally
  versus 2.77 with residency), so that plumbing was removed.
- A deeper follow-up kept all vision feature maps and the memory-attention result
  device-local, with a WebGPU feature transpose before temporal attention. Quality
  stayed exactly unchanged, but the experiment was slower overall in its A/B run:
  1.14 tracked frames/s versus 1.39 for the normal path. Vision encoding and memory
  attention became faster, but synchronization moved into mask decoding, pointer
  position, and memory encoding; total graph time increased from about 10.9 s to
  14.1 s across the 12-frame bear comparison. That partial device-local path was
  removed rather than carried as dead complexity.
- EdgeTAM remains slightly more accurate on the same bear click, but slower in the
  accepted comparison: SAM 2.1 reached 0.946 mean IoU / 0.959 boundary F at about
  1.79 tracked frames/s; EdgeTAM reached 0.955 / 0.974 at about 1.61 tracked frames/s.

The steady-state graph profiler now shows where that work belongs. On a 12-frame bear
run, JavaScript/media/tensor preparation outside ONNX accounted for only about 0.21 s.
The ONNX calls accounted for roughly 2.23 s in the vision encoder, 2.79 s in the mask
decoder, 1.25 s in memory attention, 0.70 s in memory encoding, and 0.11 s in pointer
temporal positions. The mask decoder and vision encoder are therefore the first
model-level targets. Tracked frames always use SAM's padding prompt, so a dedicated
tracked-frame decoder/export is the next experiment worth measuring before changing
memory semantics.

Safari 26.3 was manually accepted earlier for prompted scrubbing, refinement, MP4
playback, and exported WebM alpha. The latest automated Solid gate is Chromium; rerun
the checked-in Safari harness before treating a future release candidate as
cross-browser accepted. Video remains a local development experiment. Hosted/package
video-model delivery is still unfinished, and no public video API, deployment, merge,
or package release is implied by this checkpoint.

## Local editing workflow

The development/local shell now routes video from the same intake as images, including recognized video extensions when the browser supplies an empty MIME type. The hosted image intake stays image-only until production model delivery is ready. The packaged server still needs video model routes before video is a supported packaged feature.

An interior click runs the actual SAM seed operation and displays its mask before tracking. Keep and Exclude clicks refine the active subject; Add subject creates a separate memory bank, up to four subjects. The editor serializes preview, tracking, and disposal around one loaded SAM adapter. Each multi-subject seed shares its encoded frame across subjects. Rapid preview changes are debounced and stale work is aborted/ignored; an in-flight ONNX call finishes before the next queued operation or disposal. Changing the frame or trim clears prompts. The current single-mask SAM export is unchanged; this is not a new whole-object proposal algorithm and imperfect masks still need corrections.

Model preparation begins concurrently with metadata inspection immediately when the editor receives the dropped file. The native preview URL is created immediately. Once the primary-video timeline is known, the selected frame is decoded and encoded with the same adapter/cache used by selection. Prompted export borrows that editor-owned frame when the selected time is unchanged, which lets SAM reuse the already prepared vision features instead of decoding and encoding the seed again; export does not take ownership of or close the borrowed frame. A one-time prompt-decoder and memory-encoder warm-up discards its output without conditioning any temporal bank or exposing a mask. Progress counts real initialized sessions (0–5), not a timer. Loading, ready, and retryable error states are separate from selection idle/updating/ready/error states. Same-frame, same-subject-set refinements preserve the last valid highlight, but cannot authorize export until the current prompt succeeds. Seeks, cleared subjects, and removed subject identities invalidate it immediately. Effect's semaphore owns GPU exclusivity; waiting fibers are interruptible while current ONNX work is uninterruptible until it settles. Model acquisition registers its finalizer in an editor-owned Effect scope, which closes before a replacement editor can use the GPU.

Exports use MediaBunny's real quality settings and metadata tags. VP9 WebM retains alpha. H.264 MP4 bakes white or black behind the matte. Codec/dimension support is checked before tracking. Original dimensions and high encoding quality are the defaults; explicit resizing preserves aspect ratio without upscaling. Source metadata is never copied; only the optional user-entered title is passed to the muxer.

Safari defaults to explicitly opaque MP4 and shows a single native video player. Transparent WebM is still offered, with its limitation stated before export and a concise download notice afterward. A real Safari 26.3 HEVC/MP4 alpha probe through MediaBunny encoded successfully but decoded all 4096 pixels of a 64×64 transparent test frame as opaque; it is not exposed as a transparent alternative. Encoding support is checked as settings change, and playback errors retain the download with a retry control.

The 15-second memory/work budget remains explicit, but a range can start anywhere in the source. The default follows real presentation timestamps up to 60 fps, with no audio. Settings can cap the rate at 6, 24, 30 or 60 fps; a 24 fps source stays 24 real frames per second, not 60 duplicates. Packet timing is sorted in presentation order and VFR intervals are preserved. Trim and seed selection no longer snap to a 6 fps grid; output timestamps start at zero, and the final sample duration ends at the requested trim end. Invalid ranges fail rather than silently truncating. SAM still tracks both before and after the chosen seed.

The editor and export now share the precise primary-video packet timeline, not native `HTMLVideoElement.duration` or container metadata. MediaBunny's `computeDuration()` returns the last packet's end timestamp; the usable span subtracts the first presentable timestamp. UI scrubbing is relative to that span and native seeking adds its start offset. This fixes original bear MP4 defaults on Safari: native duration is 3.417 seconds but the video ends at 3.4166666666666665. The transcoded bear fixture reports 3.33203125 natively versus 3.3333333333333335 in the track, which previously hid the failure. Range validation remains strict: no epsilon and no clipping of invalid user ends.

Forward and backward tracking now consume bounded MediaBunny frame iterators rather than independently requesting every frame. Only the selected frame is retained for interaction. Stored temporal output mattes use the exact 8-bit sigmoid alpha previously produced during compositing, reducing retained 256×256 matte memory from about 225 MiB to 56 MiB for a 900-frame/15-second/60-fps clip, without changing compositing precision or introducing smoothing. Tracking memory banks and models are unchanged. Reverse decoding can still cost more than forward streaming.

### Repeatable performance and quality acceptance

Run `bun run scripts/benchmark/video-local-preview/server.ts /tmp/bgcut-rate-performance 4203 performance` and open that loopback URL in Chromium. The harness measures session load, frame warm-up, first/warm click, decode/seed/tracking/encoding time, real decoded timestamps and dimensions, plus encode PSNR against the final encoder frame. It covers bear, two independent BMX subjects, `blackswan`, `camel`, `car-shadow`, a generated moving 60 fps fixture, and a VFR/nonzero-timestamp source. Raw segmentation alpha is scored separately from the opaque MP4 encoder frame. DAVIS masks provide IoU and boundary-F checks for the real fixtures, and a same-click tracker lane compares SAM 2.1 with EdgeTAM. It saves input/output MP4s and `result.json`; output FPS, processing FPS, and temporal tracking FPS are reported separately.

### Repeatable acceptance

Start `bun run scripts/benchmark/video-local-preview/server.ts /tmp/bgcut-video-acceptance 4196`, then open `http://127.0.0.1:4196/` in a WebGPU-capable Chromium browser. The local-only harness writes `result.json` or `failure.json`, the three original subject/automatic artifacts, and `bear-trim.webm` / `bear-trim.mp4`. The added cases verify a nonempty click mask, nonzero trim start, backward tracking from an interior seed, output duration/timestamps, decoded dimensions, title metadata, WebM alpha, and MP4's opaque black background. Original multi-subject cross-negative prompts remain unchanged.

For the actual Solid UI, start `bun run dev -- --host 127.0.0.1 --port 5184 --strictPort`, install Chromium with `agent-browser install`, then run `bun run scripts/benchmark/video-local-preview/ui-e2e.ts /absolute/path/to/bear.mp4 http://127.0.0.1:5184 /tmp/bgcut-video-ui`. This checks the single intake, explicit model/frame readiness, the click mask, retained highlights during rapid refinements, stale-preview export blocking, desktop/mobile layout, the initial-viewport primary action, a real export, subject switching/clearing, seek invalidation, and switching back to the image error flow. The macOS acceptance workflow now runs this harness automatically with a pinned `agent-browser` version and uploads its screenshots/result with the other video evidence.

For Safari, start a separate `/usr/bin/safaridriver --port 4450`, then run `bun run scripts/benchmark/video-local-preview/safari-e2e.ts /absolute/path/to/bear.mp4 http://127.0.0.1:5184 /tmp/bgcut-safari-video http://127.0.0.1:4450`. The harness owns and closes its automation session, records readiness/refinement screenshots, verifies `video.play()` advances `currentTime`, samples the decoded white background, and saves the actual MP4 and JSON evidence.

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

Quality is measured separately on labeled DAVIS sequences. The original development suite contains seven clips chosen to exercise the two model families and seed-ranking failures. The repository now also knows the official 60-sequence DAVIS 2017 training split and 30-sequence validation split. Training is used for selector development; validation is used to measure generalization.

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

Those seven clips were not enough to call the selector general. The frozen rule was therefore run on all 30 sequences in the official DAVIS 2017 validation split. It fell to 0.395 mean tracked IoU and 0.418 mean tracked J&F. The failure was broader than multi-object union: several 2016 single-object clips also collapsed because the highest-stability candidate was a tiny distractor even though a much stronger proposal-0 mask existed elsewhere in the same 7×7 pool.

That validation result turned candidate ranking back into the active problem. Selector development moved to the official 60-sequence DAVIS 2017 training split. The research job recorded the full 147-candidate frame-0 grid for every training sequence using `grid-oracle`. Ground truth identified the best training candidate only for analysis.

The training data supports a small change rather than a learned ranker. Keep proposal 0, reject masks that touch the frame, then rank the rest by `stability * sqrt(areaFraction)`. On alternating 30-sequence training halves, this rule reached 0.465 and 0.505 mean frame-0 J&F. Pure stability averaged 0.395 across the 60 training sequences. Allowing frame-touching masks or switching away from proposal 0 was substantially worse. The next validation run freezes this rule exactly; validation scores do not change its coefficients or filters.

The frozen area-weighted selector improved the official 30-sequence validation split to 0.475 mean tracked IoU and 0.504 mean tracked J&F, up from 0.395 / 0.418 for pure stability. That confirms the training-derived anti-tiny-mask term generalizes, but single-mask selection still leaves a large gap on multi-object foregrounds.

The next training-only diagnostic evaluates 48 fixed proposal-0 union rules on frame 0. The rules vary minimum stability, predicted IoU, foreground area, and frame-edge rejection, then OR every accepted mask. Duplicate discoveries do not hurt a union, so this stage deliberately avoids another ranking heuristic. After one union rule is chosen from training, EdgeTAM can be conditioned directly from the union matte and temporally evaluated on validation.

The oracle proposal runs also exposed a separate result: for all seven current DAVIS sequences, the best mask among the three masks returned at the known subject point was proposal 0. EdgeTAM's predicted-IoU ranking was the source of the catastrophic `car-shadow` and `car-turn` seed choices. This makes proposal 0 a strong ranking control once a subject point is already known, but it does not by itself solve automatic subject discovery.

### Multi-object union search

The single-mask validation failure is not solved by retuning one mask. A training-only search on all 60 DAVIS 2017 training sequences therefore scored fixed unions of proposal-0 masks across stability, model-IoU, area, and frame-edge filters.

The best training rule is frozen as `s0.5-i0-a0.002-e1`:

- stability at least 0.5
- no minimum EdgeTAM model-IoU score
- foreground area at least 0.2% of the frame
- reject masks that touch the frame edge
- union every surviving proposal-0 mask

Across the 60-sequence training split, that fixed rule averaged 0.406 frame-0 IoU and 0.441 frame-0 J&F while keeping about 4.5 masks per clip. Stricter model-IoU thresholds, larger area floors, and higher stability thresholds all reduced mean J&F.

The frozen rule was then evaluated unchanged on the untouched 30-sequence DAVIS 2017 validation split. It reached 0.478 mean frame-0 IoU and 0.502 mean frame-0 J&F while retaining six masks per clip on average. That is a real seed improvement over the area-weighted single-mask selector's 0.455 / 0.482, but it is not large enough to justify multiplying temporal tracker state yet. Three validation clips still produced no accepted masks at all, and several others unioned stable distractors rather than the annotated foreground.

The same 7×7 candidate pool has substantially more headroom: the grid oracle reaches 0.596 mean frame-0 IoU and 0.662 mean frame-0 J&F on validation, then 0.637 mean tracked IoU and 0.687 mean tracked J&F. A small linear ranker trained only on candidate geometry, stability, predicted IoU, centroid and proposal index did not close that gap; it reached 0.467 seed J&F on validation. The remaining selector problem therefore needs semantic foreground information, not another geometric coefficient.

### BiRefNet as a semantic prior

bgcut already owns a semantic foreground model: BiRefNet. It costs no new model family for the product, and the earlier `car-shadow` probe showed that when its frame-0 matte is confident it can select the correct EdgeTAM proposal and preserve excellent temporal tracking.

The focused twelve-clip pass split cleanly. BiRefNet returned no positive pixels on eight failures. On the four clips where it did return foreground, its semantic matte was strong: `breakdance` 0.812 frame-0 J&F, `dance-twirl` 0.858, `libby` 0.918, and `shooting` 0.946. The existing point/proposal handoff preserved that quality only on `breakdance`; it threw most of the semantic signal away on the other three.

The direct-matte experiment succeeds on all four semantic-positive failures. After the 512×512 BiRefNet logits are bilinearly resampled to EdgeTAM's 256×256 decoder mask grid, seed quality is effectively unchanged and temporal tracking is strong:

- `breakdance`: 0.869 mean tracked IoU / 0.872 J&F
- `dance-twirl`: 0.909 / 0.932
- `libby`: 0.930 / 0.962
- `shooting`: 0.950 / 0.935

This is a large recovery over the click bridge on the same clips. `dance-twirl` moves from 0.021 to 0.909 tracked IoU, `libby` from 0.256 to 0.930, and `shooting` from 0.105 to 0.950. The experiment confirms that EdgeTAM's temporal memory can carry a high-quality external foreground matte; the lossy step was turning that matte back into one point.

### Automatic hybrid policy

The next validation policy is fixed before seeing the new 30-sequence result:

1. run bgcut's local BiRefNet on frame 0
2. if BiRefNet has any positive foreground pixels, resample that matte and condition EdgeTAM memory directly
3. if BiRefNet abstains, run EdgeTAM's 7×7 discovery grid and choose proposal 0 among non-edge masks by `stability * sqrt(areaFraction)`
4. track the selected seed with the unchanged EdgeTAM temporal memory path

Ground truth is used only after selection for scoring. This is the first full product-shaped automatic policy in the research branch: both branches are deployable local model paths and neither branch consults DAVIS annotations to decide what to track.

The full 30-sequence validation run confirms the hybrid. Mean tracked IoU rises to 0.572 and mean tracked J&F to 0.603, up from 0.475 / 0.504 for the frozen Edge-only selector. BiRefNet produced foreground on 17 of 30 sequences; those direct-matte tracks averaged 0.827 IoU and 0.847 J&F. The 13 BiRefNet-abstain sequences used the Edge grid fallback and averaged 0.239 / 0.284. The same candidate pool's grid oracle is still higher at 0.637 / 0.687, so the remaining quality gap is concentrated in semantic discovery on BiRefNet-abstain clips rather than EdgeTAM temporal propagation.

The next optimization changes precision, not policy. bgcut's pinned browser FP16 BiRefNet artifact is 98,572,669 bytes versus 195,872,736 bytes for FP32. EdgeTAM's complete fp16 temporal stack is about 60 MB, so FP16 BiRefNet would reduce the combined local model payload from roughly 256 MB to roughly 159 MB. The quality benchmark now reruns the exact same 30-sequence hybrid with the FP16 BiRefNet graph; no selector thresholds or fallback rules change.

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
