# Improvement Roadmap

This file records the concrete improvements that should move `bgremove` from a working local background remover into a differentiated GPU-native cutout engine and editor.

The goal is not to claim superiority before evidence exists. Competitive and performance claims must be backed by exact-head validation and repeatable benchmarks.

## Accepted baseline

Manual browser acceptance passed on 2026-09-15 at exact SHA:

`e2a79a631aee338d82bd49a878e142a805227977`

Observed on that frozen commit:

- `bun install --frozen-lockfile` passed with Bun 1.4.2.
- `bun run check` passed; 5 tests passed and the build succeeded.
- All five WebGPU/runtime diagnostics were green.
- A 1600×1598 cat image produced a sensible fur, ear, and whisker matte and exported an RGBA PNG at the same 1600×1598 resolution.
- A 1200×800 dog image produced a sensible matte and exported at the same 1200×800 resolution.
- The model/session was reused for the second image; there was one model resource entry and no second model request.
- SVG input produced the expected typed unsupported-image error without crashing.
- The console showed no WebGPU validation errors, Solid errors, uncaught exceptions, or target crashes.
- ONNX Runtime emitted two shape-node-on-CPU performance warnings; these were non-fatal and should be treated as a performance investigation item rather than a correctness failure.

This acceptance applies only to `e2a79a631aee338d82bd49a878e142a805227977`. `bootstrap` advanced after that SHA, so later heads require their own exact-head acceptance before merge/release claims.

## Competitive baseline

### BG0

BG0 is already a serious local-browser competitor, not just a privacy proof of concept. As inspected on 2026-09-15, current BG0 includes:

- browser-local inference with no image upload
- WebGPU with WASM fallback
- an embeddable `@bg0/browser` package
- cancellation with `AbortSignal`
- structured progress
- stable public errors
- browser capability reporting
- persistent model caching using Cache API with IndexedDB fallback
- initialized-engine reuse
- FP16 BiRefNet Lite
- PNG, JPEG, WebP, HEIC, and HEIF support
- WebGPU output sanity checks and compatibility retry
- a `fast | quality` API
- an additional focused inference pass in quality mode when the subject crop can materially improve effective model resolution

Reference repository: `opencoredev/bg0`.

Competitive notes must be rechecked against current upstream before making public claims. The BG0 `main` head inspected while writing this file was `863c2500203e3f89d5489da0484e695dd614a911`.

### remove.bg

remove.bg remains the product-maturity benchmark. It is stronger in areas such as:

- erase/restore and assisted brush correction
- bulk workflows
- desktop workflows
- API/CLI and automation surface
- third-party integrations
- general editing and background replacement workflows

Raw output-quality comparisons must be benchmarked on the same corpus. Do not claim that remove.bg, BG0, or this project has better segmentation quality without evidence.

## Product direction

The intended differentiation is:

> A private, embeddable, GPU-native cutout engine and editor where preprocessing, inference, refinement, compositing, and interactive mask editing can remain on one GPU pipeline.

Privacy alone is not a moat because BG0 already provides local browser inference. The differentiator must come from lower-level GPU ownership, better refinement/editing, measurably better performance where possible, and a strong engine API.

## Priority 0 — exact-head validation and benchmarks

Before optimizing, establish a benchmark harness and a representative image corpus.

### Benchmark corpus

Include at least:

- long hair
- curly/fine hair
- fur
- whiskers
- eyeglasses
- bicycle spokes and other thin structures
- leaves and plants
- white-on-white products
- dark-on-dark subjects
- translucent or semi-transparent edges
- multiple people
- tiny subjects in large images
- full-frame subjects
- large phone photos

### Metrics

Record separately:

- cold model download time
- cold model/session initialization time
- warm inference time
- preprocessing time
- inference time
- GPU-to-CPU and CPU-to-GPU transfer time where measurable
- refinement time
- compositing time
- export time
- total wall time
- peak CPU memory where measurable
- peak GPU memory where measurable
- output dimensions
- provider used
- model revision/dtype
- failure/fallback behavior

For quality, use the same source corpus for this project, BG0, and remove.bg. Prefer objective alpha-matte metrics when ground-truth mattes are available and otherwise keep visual comparisons labeled as subjective.

## Priority 1 — first-class engine and job lifecycle

The current UI bootstrap should not become the long-term owner of inference state, cancellation, cleanup, caching, and progress.

Introduce a small engine boundary that is independent of Solid.

Target shape:

```ts
interface RemovalEngine {
  readonly capabilities: EngineCapabilities

  remove(
    source: ImageSource,
    options?: RemovalOptions,
  ): Effect.Effect<CutoutResult, RemovalError>
}

type RemovalOptions = {
  quality?: "fast" | "quality"
  signal?: AbortSignal
  onProgress?: (event: RemovalProgress) => void
}
```

Progress should expose real stages rather than one generic processing flag, for example:

```ts
type RemovalProgress =
  | { stage: "model-loading"; progress: number }
  | { stage: "preprocessing"; progress: number }
  | { stage: "inference"; progress: number }
  | { stage: "refining"; progress: number }
  | { stage: "compositing"; progress: number }
  | { stage: "exporting"; progress: number }
```

Use Effect for cancellation, scopes, cleanup, retry, device-loss boundaries, and typed failures. Keep shader/image loops plain TypeScript, TypeGPU, or raw WebGPU where that is clearer.

Reference patterns:

- Diffusion Studio: one canonical operation owns progress, cancellation, cleanup, and lifecycle restoration.
- OpenCode: keep UI state separate from lower-level runtime services and expose narrow contexts/capabilities.
- Pi: prefer small explicit capability surfaces over leaking runtime internals.

## Priority 2 — GPU-resident image pipeline

The current path still performs important CPU round trips:

```text
ImageBitmap
  -> Canvas2D resize
  -> CPU RGBA
  -> CPU Float32 normalization
  -> ORT WebGPU
  -> CPU logits
  -> CPU alpha conversion
  -> Canvas2D scaling/compositing
```

The target path is:

```text
ImageBitmap
  -> GPU texture
  -> TypeGPU resize/normalize
  -> GPUBuffer input
  -> ORT WebGPU
  -> GPUBuffer output
  -> TypeGPU sigmoid/refinement
  -> GPU matte
  -> GPU source-resolution compositing
  -> preview/export
```

Concrete work:

1. Add timing around the current CPU preprocessing and output readback so there is a baseline.
2. Research and prototype ORT WebGPU GPU-buffer I/O against the exact pinned ONNX Runtime version before changing product code.
3. Build a TypeGPU preprocessing path that matches the current CPU reference numerically within an explicit tolerance.
4. Keep model output on GPU when supported.
5. Implement sigmoid/matte conversion on GPU.
6. Move compositing to GPU.
7. Keep the CPU implementation as a test/reference path while the GPU implementation stabilizes.
8. Measure before claiming the GPU-native path is faster.

Do not optimize solely to remove every CPU operation. Prefer the architecture that wins measured latency, memory use, correctness, and browser reliability.

## Priority 3 — quality beyond BG0's focused crop pass

BG0 already performs a useful subject-crop second pass in quality mode, so simply copying that does not differentiate this project.

Build toward uncertainty- and edge-directed refinement:

```text
base inference
  -> confidence / edge analysis
  -> identify difficult regions
  -> higher-resolution local tiles or focused passes
  -> merge into base matte
  -> edge-aware refinement
```

Candidate refinement stages:

- threshold adjustment
- feathering
- erosion/dilation or edge shift
- despeckle
- small-hole cleanup
- edge decontamination / color spill cleanup
- guided or source-aware edge refinement
- uncertain-region local re-inference

Each stage needs a correctness reference and benchmark. Avoid a stack of heuristics that cannot be independently tested or disabled.

Expose user-facing complexity as a small number of modes such as `fast` and `quality` rather than making normal users choose model internals.

## Priority 4 — non-destructive mask editor

The result should evolve from a static before/after preview into an editable cutout document.

Target model:

```ts
type CutoutDocument = {
  source: SourceImage
  baseMask: MaskHandle
  corrections: readonly MaskOperation[]
  refinement: RefinementSettings
  background: BackgroundSettings
}
```

Manual edits must be non-destructive. Restore/erase strokes should be operations layered over the model matte rather than permanently rewriting the base inference result.

Add in this order:

1. mask visualization
2. zoom/pan
3. restore brush
4. erase brush
5. undo/redo
6. before/after toggle
7. live refinement controls
8. background color/image preview
9. assisted edge-aware brush behavior

Keep high-frequency pointer/brush state out of broad Solid reactive state. GPU updates and transient brush sampling should live in the editor/runtime layer and publish only the state the UI actually needs.

Reference patterns:

- DAW Browser Convex and Diffusion Studio for performance-sensitive editor/runtime separation.
- DialKit for compact, declarative live-parameter APIs.

## Priority 5 — compatibility and input support

BG0 currently has a stronger compatibility story.

Add deliberately rather than hiding provider changes:

- explicit WebGPU capability detection
- explicit compatibility/fallback provider
- output sanity validation before accepting a WebGPU result
- provider surfaced in diagnostics and result metadata
- remembered known-bad runtime/device combinations where justified
- HEIC/HEIF support
- robust content/signature validation rather than trusting MIME type alone
- image-size/memory limits with useful errors

Any fallback must document whether it changes quality, model dtype, or output semantics.

## Priority 6 — model lifecycle and persistence

Improve first-run and repeat-use behavior:

- versioned model manifest
- persistent cache with exact model revision and integrity metadata
- predictable cache invalidation
- explicit `clearModelCache()` capability
- initialized-session reuse
- device-loss-safe session disposal/recreation
- optional model warmup
- evaluate FP16 only with quality/performance measurements

Keep large model/image data out of Solid stores.

Suggested persistence split:

```text
localStorage
  -> lightweight UI preferences
  -> refinement defaults

IndexedDB / Cache Storage / OPFS
  -> model artifacts
  -> project metadata
  -> resumable batch state
  -> large local assets where needed
```

Use Solid Primitives as an API/lifecycle reference for small persisted reactive state rather than inventing a custom persistence framework.

## Priority 7 — batch processing

After one-image correctness and lifecycle are solid, add a local scheduler rather than looping `remove()` blindly.

Requirements:

- bounded concurrency based on device/memory constraints
- queue pause/resume/cancel
- per-job status and errors
- session/model reuse
- recovery from one failed image without dropping the queue
- optional resumable queue metadata
- bulk download/export flow
- source-resolution guarantees per item

Benchmark throughput and memory pressure. Do not optimize for maximum concurrent jobs if serial or low-concurrency GPU submission is faster or more stable.

## Priority 8 — public headless API

Do not extract a package prematurely. Let the application prove the engine boundary first.

Once there is a real second consumer, publish/extract an engine package with a small public API. Application consumers should not need to know about ONNX sessions, tensor shapes, TypeGPU roots, shader modules, or raw GPU buffers.

Potential public capabilities:

```ts
removeBackground(input, options)
getCapabilities()
clearModelCache()
createEditorDocument(input)
refineMask(mask, settings)
composite(source, mask, options)
```

BG0 already has a clean one-call library, so merely publishing a package is not differentiation. The API should expose composable lower-level editing/refinement capabilities without leaking implementation details.

## Suggested code organization

Do not create packages solely for organizational appearance. Keep the repository simple until multiple real consumers justify package boundaries.

A useful near-term shape is:

```text
src/
  domain/
    cutout-document.ts
    operations.ts
    refinement.ts

  engine/
    api.ts

    runtime/
      gpu.ts
      capabilities.ts

    models/
      model.ts
      registry.ts
      birefnet-lite.ts

    pipeline/
      preprocess.ts
      inference.ts
      refine.ts
      composite.ts
      export.ts

    jobs/
      progress.ts
      job.ts

    cache/
      model-cache.ts

  editor/
    editor-state.ts
    history.ts
    brush.ts
    actions.ts

  app/
    context/
    components/

  App.tsx
```

Only introduce a directory/abstraction when it owns a real boundary.

## API and architecture references

Use the repository references already documented in `AGENTS.md`:

- **Diffusion Studio** — editor/runtime separation, unified long-running job lifecycle, rendering/export boundaries.
- **DialKit** — live parameter configuration and compact control APIs.
- **OpenCode v2** — Solid contexts, application/service separation, persistence and command/action organization.
- **Solid Primitives** — lifecycle-safe browser primitives and persistence APIs.
- **DAW Browser Convex** — realtime/high-frequency runtime boundaries, worker/protocol organization, fine-grained state updates.
- **Pi** — narrow capabilities, composable APIs, and avoiding unnecessary abstraction layers.

Reference projects are sources of patterns and tradeoffs, not templates to clone.

## Release and claim gates

Before calling an improvement complete:

- `bun install --frozen-lockfile`
- `bun run lint`
- `bun run typecheck`
- `bun test`
- `bun run build`
- exact-head CI green
- exact-head browser acceptance for runtime-affecting changes
- no WebGPU validation errors
- no uncaught browser/runtime errors
- source-resolution export preserved
- tests cover observable contracts rather than private implementation details

Before claiming competitive superiority:

- test the same corpus and hardware/browser where applicable
- record exact project SHA, competitor version/SHA, model revision, browser, GPU, and settings
- separate cold-start and warm-run results
- separate measured facts from subjective visual judgments
- retain benchmark inputs/results so regressions can be reproduced

## Near-term sequence

The next implementation sequence should be:

1. Revalidate the current `bootstrap` exact head because the accepted SHA predates later anti-slop/tooling/source changes.
2. Add benchmark instrumentation to the existing CPU/Canvas pipeline without changing its output.
3. Introduce the engine/job boundary with cancellation and structured progress.
4. Prototype GPU-buffer ORT I/O and TypeGPU preprocessing behind a reference comparison test.
5. Move matte conversion/refinement and compositing onto GPU only after correctness is proven.
6. Add quality refinement that goes beyond a whole-subject second crop pass.
7. Build the non-destructive restore/erase editor.
8. Add compatibility fallback, richer input formats, persistent model lifecycle, then batch processing.
