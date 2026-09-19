# Improvement roadmap

This file tracks work that is not part of the current public product contract.

Do not turn planned work into product claims. Performance and output-quality claims need exact commits, repeatable inputs, and recorded results.

## Current baseline

The current product has two working paths.

The browser path uses a shared WebGPU device, TypeGPU preprocessing, ONNX Runtime WebGPU graph capture, GPU output readback, and source-resolution PNG export. The accepted graph-capture benchmark recorded a 422 ms warm median on the documented 1600x1598 cat fixture. See [`../performance/graph-capture.md`](../performance/graph-capture.md) for the exact commit, runtime, model, and timings.

The CLI uses ONNX Runtime Node. Automatic mode tries native WebGPU first and falls back to CPU when a WebGPU session cannot start. The CLI accepts JPEG, PNG, WebP, and AVIF and preserves source dimensions in the output.

The production web target is `bgcut.dev`. Workers Static Assets carry the app shell, while the ONNX model and discrete ONNX Runtime runtime files are served through the same Worker from private R2.

## 1. Maintain the browser UI

The normal browser flow is now limited to clicking or dropping an image, running removal automatically, comparing the original with the result, then copying, downloading, redoing, or choosing a new image. Developer diagnostics, timing tables, model details, and internal acceptance controls are not part of the product view.

For changes to this flow:

1. Check the current layout against the accepted product UI.
2. Check drag and drop, keyboard use, mobile layout, processing, errors, slider interaction, copy, download, redo, and new-image behavior in a real browser.
3. Check normal WebGPU, explicit WebGPU, and explicit WebAssembly through the local Cloudflare Worker and R2 path with a clean console when runtime behavior changes.
4. Verify the packaged local app separately from the hosted site when shell or routing behavior changes.
5. Deploy the accepted candidate to `bgcut.dev` and repeat the affected hosted-browser checks.

Editor controls, batch processing, and advanced settings require their own product scope. Do not fold them into the accepted single-image flow incidentally.

## 2. Define a browser engine API

The UI should not own ONNX sessions, cancellation, cache state, or GPU cleanup.

Use a small engine interface that can run without Solid:

```ts
interface RemovalEngine {
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

Progress events should report real work such as model loading, preprocessing, inference, compositing, and export.

Use Effect for cancellation, cleanup, retries, device loss, and typed failures. Keep image and shader loops in plain TypeScript, TypeGPU, or raw WebGPU when that is simpler.

## 3. Keep more work on the GPU

The current browser fast path still reads model output back to the CPU before final matte work and export.

Potential next steps:

1. Measure every remaining CPU and GPU transfer.
2. Keep model output on the GPU when the runtime supports it reliably.
3. Move sigmoid and matte conversion to TypeGPU.
4. Test GPU compositing against the current source-resolution output.
5. Keep CPU reference implementations for correctness tests.

Do not remove a CPU step only because it is a CPU step. Keep the path that measures better and stays correct across supported browsers.

## 4. Improve difficult edges

Quality work should focus on cases where one 512x512 inference pass loses useful detail.

Use a fixed test set that includes:

- long and fine hair
- fur and whiskers
- glasses
- bicycle spokes and other thin structures
- leaves and plants
- light subjects on light backgrounds
- dark subjects on dark backgrounds
- translucent edges
- small subjects in large images
- large phone photos

Possible refinement work includes local high-resolution passes, threshold controls, feathering, edge shift, small-hole cleanup, color-spill cleanup, and source-aware edge refinement.

Each stage needs an isolated correctness test and a measured cost.

## 5. Add non-destructive editing after the basic UI is solid

A future editor should keep the model result separate from user corrections.

```ts
type CutoutDocument = {
  source: SourceImage
  baseMask: MaskHandle
  corrections: readonly MaskOperation[]
  refinement: RefinementSettings
  background: BackgroundSettings
}
```

A practical order is:

1. mask view
2. zoom and pan
3. restore brush
4. erase brush
5. undo and redo
6. refinement controls
7. background preview

Pointer sampling and brush updates should stay out of broad Solid state. Publish only the state the UI needs.

## 6. Expand compatibility deliberately

Useful compatibility work includes:

- clearer WebGPU capability checks
- provider information in diagnostics
- output sanity checks before accepting a GPU result
- HEIC and HEIF input support
- image-size and memory limits with useful errors
- device-loss-safe session recreation

Any fallback must document whether it changes the model, output, or performance characteristics.

## 7. Improve model lifecycle

Keep model and session behavior predictable:

- versioned model metadata
- exact integrity checks
- explicit cache invalidation
- a clear model-cache command or API
- session reuse
- device-loss-safe disposal
- optional warmup only if measurements justify it

Large model and image data should not live in Solid stores.

## 8. Add batch work after single-image behavior is stable

Batch processing needs a scheduler rather than a loop around `remove()`.

It should support bounded concurrency, pause, resume, cancel, per-image errors, model reuse, and recovery after one failed job.

Benchmark throughput and memory use before choosing the concurrency level.

## 9. Expose a headless library only when there is a second consumer

Do not split out a package only for repository organization.

A future library might expose:

```ts
removeBackground(input, options)
getCapabilities()
clearModelCache()
createEditorDocument(input)
refineMask(mask, settings)
composite(source, mask, options)
```

Application code should not need ONNX tensor shapes, TypeGPU internals, or raw GPU buffers.

## Reference repositories

The reference repositories in [`../../AGENTS.md`](../../AGENTS.md) are useful for specific implementation questions:

- Diffusion Studio for editor and media-runtime boundaries
- DialKit for small live controls
- OpenCode for Solid application structure and persistence
- Solid Primitives for browser lifecycle helpers
- DAW Browser Convex for worker and high-frequency runtime patterns
- Pi for small explicit interfaces

Use only the part that solves the current problem.

## Validation

Before merging runtime work:

```sh
bun install --frozen-lockfile
bun run check
```

Web deployment changes also need:

```sh
bun run cloudflare:dry-run
bun run cloudflare:runtime:smoke
```

Runtime changes need exact-head browser acceptance on the affected path. Record the commit, input, browser, provider, output dimensions, warnings, errors, and measured timings when performance is part of the change.

Before making a performance claim, compare the same input on the same hardware and browser. Separate cold setup from warm execution and report medians when multiple runs are available.
