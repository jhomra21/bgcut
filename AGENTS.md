# AGENTS.md

## Engineering defaults

- Use Bun for dependency management, scripts, tests, and workspace operations. Do not use npm, pnpm, or yarn.
- Use Solid 2 for the UI and reactive application state. Pin the Solid 2 RC packages exactly while 2.0 is pre-release.
- Use Effect at asynchronous and system boundaries: GPU initialization, device loss, model loading, model caching, image decoding, worker communication, inference jobs, cancellation, retries, timeouts, persistence, and export.
- Do not introduce Effect abstractions into tight GPU or image-processing loops where plain TypeScript, TypeGPU, or raw WebGPU is clearer.
- Prefer explicit tagged domain errors over generic thrown errors.
- Validate data that crosses worker, persistence, model-manifest, or external boundaries with Effect Schema.
- Use TypeGPU for GPU compute and image-processing pipelines. Drop down to raw WebGPU when TypeGPU makes an operation harder instead of simpler.
- Keep Solid components unaware of ONNX Runtime sessions, GPU buffers, shader implementation details, and model internals.
- Keep the inference/image engine usable independently from the UI.
- Prefer the smallest implementation that satisfies the current requirement. Do not add an abstraction until there is a concrete second use case.
- Run `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` before considering a change complete.
- oxlint is mandatory.
- Tests should be change detectors for observable behavior and contracts, not implementation details.

## Anti-slop

- Anti-slop is mandatory and is vendored project source at `tools/oxlint/anti-slop/` from `dmmulroy/anti-slop`.
- Do not replace the vendored rules with an unofficial npm package. Upstream explicitly treats anti-slop as vendored source owned by the consuming repository.
- The exact upstream revision and any intentional local deviations must be recorded in `tools/oxlint/anti-slop/UPSTREAM.md`.
- `oxlint` and `@oxlint/plugins` must stay pinned to exactly matching versions.
- Enable every canonical generic anti-slop rule and, because this repository directly uses Effect, every canonical Effect anti-slop rule.
- Keep `tools/oxlint/anti-slop/**` out of application lint traversal; the vendored plugin is tooling source, not product source.
- Keep plain `bun test` as the canonical application test command. Project-level `bunfig.toml` excludes `tools/oxlint/anti-slop/**` from Bun test discovery so vendored upstream maintainer tests remain intact without running under Bun's unsupported Oxlint `RuleTester` environment.
- When upstream changes, review and merge the vendored update while preserving project-local customizations and provenance. Do not force-replace the directory blindly.
- Do not weaken rule severity, disable a rule, add unsafe casts, or launder types merely to make lint pass. Fix owned product code when the rule exposes a real issue.
- Treat anti-slop findings as design feedback. Prefer clearer evidence, narrow boundaries, explicit Effect services/errors, and simple data flow over suppressions.

## Product constraints

- Image processing and inference must run locally in the browser. Do not add an image-upload backend as a shortcut.
- The WebGPU path is the primary architecture. Any CPU/WASM fallback must be explicit and must not silently change output quality.
- Preserve the original source image resolution for final compositing/export even when inference uses a smaller working resolution.
- Prefer one shared `GPUDevice` across ONNX Runtime WebGPU and TypeGPU so GPU resources can be shared and unnecessary CPU/GPU copies can be removed over time.
- Model-specific behavior belongs behind an inference boundary so a future native TypeGPU implementation can replace ONNX Runtime without changing the Solid UI.

## Reference Codebases

Reference these codebases when designing APIs, code, architecture, persistence, UI systems, or other programming solutions. Use them to understand patterns and tradeoffs, not as requirements to copy their abstractions.

### Diffusion Studio

**Repositories / sources**
- `diffusionstudio/editor` — https://github.com/diffusionstudio/editor
- Diffusion Studio `monorepo-new` when available locally or through authorized repository access

**Role:** Full-stack video editing platform and application architecture.

Reference for editor architecture, media pipelines, editor state, application boundaries, worker/background processing, larger product organization, and performance-sensitive editing interactions. Prefer the smallest relevant pattern instead of reproducing the whole editor architecture.

### DialKit

**Repository:** `joshpuckett/dialkit` — https://github.com/joshpuckett/dialkit

**Role:** Real-time parameter tweaking and UI reference for React, Solid, Svelte, and Vue.

Reference for fine-grained interactive controls, parameter editing, Solid integrations, reactive UI APIs, and small composable primitives. It is especially relevant to mask controls such as threshold, feathering, erosion, dilation, and edge refinement.

### OpenCode v2

**Repository:** `anomalyco/opencode` — https://github.com/anomalyco/opencode

**Role:** Solid application, persistence, preferences, and product architecture reference.

Reference for Solid application architecture, persistence, application preferences, service boundaries, command/action design, and keeping frontend state separate from lower-level runtime services. Do not copy complexity that exists only because OpenCode is a coding-agent platform.

### Solid Primitives

**Repository:** `solidjs-community/solid-primitives` — https://github.com/solidjs-community/solid-primitives

**Role:** Solid library and API-design reference.

Reference especially for storage and persistence primitives, lifecycle handling, browser APIs, cleanup semantics, and composable Solid APIs. Before inventing a general-purpose Solid primitive, check whether Solid Primitives already provides the behavior or demonstrates an established pattern.

### DAW Browser Convex

**Repository:** `jhomra21/daw-browser-convex` — https://github.com/jhomra21/daw-browser-convex

**Role:** Audio DSP and performance-sensitive browser application reference.

Reference for worker architecture, realtime processing, DSP-style pipelines, browser/runtime boundaries, high-frequency state, editor architecture, and avoiding UI work on performance-sensitive paths. Borrow architectural and performance ideas rather than audio-specific abstractions.

### Pi

**Repository:** `earendil-works/pi` — https://github.com/earendil-works/pi

**Role:** Small, composable agent/application architecture reference.

Reference for simple APIs, composable building blocks, narrow interfaces, explicit capabilities, avoiding unnecessary framework layers, and code that remains understandable to humans and coding agents. Use Pi as a counterweight when another reference suggests a heavier abstraction.

## Reference-codebase policy

When designing a new subsystem:

1. Look for an analogous pattern in the reference codebases.
2. Understand why that pattern exists before adopting it.
3. Prefer the smallest version that satisfies this repository's actual requirements.
4. Do not add an abstraction solely because a reference project has one.
5. Do not copy code blindly. Reimplement the underlying idea for this project's constraints.
6. When references disagree, prefer fewer concepts, clearer ownership, stronger type safety, and easier testing.
7. For GPU or inference-specific decisions, benchmark instead of assuming an architecture is faster.
