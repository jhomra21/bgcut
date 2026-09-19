# AGENTS.md

## Engineering defaults

- Use Bun for dependency management, scripts, tests, and workspace operations.
- Use Solid 2 for the UI and reactive application state. Keep the Solid 2 RC packages pinned while 2.0 is prerelease.
- Use Effect at asynchronous and system boundaries such as GPU setup, device loss, model loading, model caching, image decoding, inference jobs, cancellation, retries, timeouts, persistence, and export.
- Keep tight GPU and image-processing loops in plain TypeScript, TypeGPU, or raw WebGPU when that is clearer than Effect.
- Prefer tagged domain errors over generic thrown errors.
- Validate worker, persistence, model-manifest, and external data with Effect Schema when validation adds a real boundary.
- Use TypeGPU for GPU compute and image-processing code when it keeps the implementation simpler. Use raw WebGPU when it does not.
- Keep Solid components separate from ONNX Runtime sessions, GPU buffers, shaders, and model internals.
- Keep the image engine usable without the browser UI.
- Add an abstraction only when a concrete second use case needs it.
- Run `bun run check` before considering a change complete.
- oxlint is required.
- Tests should cover observable behavior and contracts rather than private implementation details.

## Repository layout

- `src/app/`: Solid UI, hosted-site shell, local-app shell, styles, and app-level tests.
- `src/engine/`: browser inference, WebGPU/WebAssembly runtime code, image processing, and engine tests.
- `src/cli/`: command parsing, headless CLI behavior, model cache, and the packaged loopback server.
- `src/node/`: reusable Node API and native ONNX Runtime execution.
- `src/shared/`: utilities shared by native surfaces without UI or CLI ownership.
- `src/worker/`: Cloudflare Worker routing and Worker-specific tests.
- `scripts/brand/`: generated brand assets.
- `scripts/cloudflare/`: Cloudflare build, runtime upload, and smoke tooling.
- `scripts/model/`: model preparation and integrity tooling.
- `scripts/package/`: npm package preparation and installed-consumer smoke tests.
- `tests/`: repository-level policy tests that do not belong to one runtime surface.
- `docs/operations/`: deployment and release runbooks.
- `docs/engineering/`: benchmark and implementation records.
- `docs/roadmap.md`: planned work that is outside the current public product contract.

Keep the repository as one package until a concrete second package needs an independent dependency or release boundary. OpenCode and Pi use workspaces because they ship many distinct packages; bgcut should copy their ownership clarity, not their monorepo size.

## Anti-slop

- The vendored anti-slop plugin lives at `tools/oxlint/anti-slop/` and comes from `dmmulroy/anti-slop`.
- Do not replace it with an unofficial npm package.
- Record the exact upstream revision and intentional local changes in `tools/oxlint/anti-slop/UPSTREAM.md`.
- Keep `oxlint` and `@oxlint/plugins` on the same exact version.
- Enable the canonical generic rules and the Effect rules used by this repository.
- Exclude `tools/oxlint/anti-slop/**` from application lint and Bun test discovery. The vendored maintainer tests use Oxlint's Node and tsx test environment.
- When updating the vendored plugin, review upstream changes and preserve documented local changes.
- Do not disable a rule, weaken its severity, add unsafe casts, or hide a type problem only to make lint pass.
- Fix owned code when a rule finds a real design or readability problem.

## Product constraints

- Browser image processing and inference must stay local. Do not add an image-upload backend as a shortcut.
- WebGPU is the primary browser path. Any fallback must be explicit and must not silently change output behavior.
- Preserve the source image dimensions for final compositing and export.
- Prefer one shared `GPUDevice` across ONNX Runtime WebGPU and TypeGPU when the runtime contract supports it.
- Keep model-specific behavior behind the inference boundary so the UI does not depend on ONNX details.
- Keep public documentation focused on bgcut. Do not expose internal comparison-tool names or acceptance fixtures unless they become part of the public product contract.
- Keep the normal browser UI limited to the user flow. Developer diagnostics and benchmark controls do not belong in the main product surface.

## Web deployment policy

- The production web target is `bgcut.dev` on Cloudflare Workers.
- `wrangler.jsonc` is the source of truth for Cloudflare configuration.
- The Vite app is served through Workers Static Assets.
- The 187 MiB ONNX model must not be deployed as a static asset. Serve it from the private `bgcut-models` R2 bucket through the Worker at the existing `/models/...` path.
- Serve all discrete ONNX Runtime runtime files from the same R2 bucket through `/runtime/...`: the WebGPU asyncify WASM binary, the standard WASM fallback binary, and the runtime module loader.
- The Worker may serve application, model, and runtime bytes. It must not receive source images or perform inference.
- `build:cloudflare` must omit `public/models`, remove discrete ONNX Runtime runtime files from Static Assets, and fail if one leaks back into the static payload.
- Keep the standard ONNX Runtime WASM fallback as a separate compatibility path. Both runtime binaries belong in R2 even though they serve different execution paths.
- Run `bun run cloudflare:dry-run` and `bun run cloudflare:runtime:smoke` for web deployment changes.
- Run the local R2 and Worker path before the first production deploy. See `docs/operations/deploying.md`.
- Do not deploy `bgcut.dev` to production until the exact browser candidate has passed visual and interaction acceptance.
- Production deploys run through Cloudflare Workers Builds connected directly to GitHub. `main` is the production branch.
- Keep the Cloudflare build command blank; `wrangler.jsonc` owns the Cloudflare-specific build via `build.command`.
- `cloudflare:deploy` must seed the pinned ONNX Runtime files into remote `bgcut-models` before deploying the Worker.
- Keep the desired observability policy in `wrangler.jsonc`. If Cloudflare's script-level Logs or Traces toggles are off, enable them once in the Worker dashboard; Workers Builds does not expose its managed deploy token to arbitrary post-deploy API scripts.
- Do not add Cloudflare account IDs or API tokens to GitHub for this deployment path. Workers Builds owns the deployment credential.

## Release and package policy

- Use prerelease semver and the npm `beta` tag for release candidates that still need published-package acceptance.
- Stable versions have no prerelease suffix and publish to npm `latest` only after the corresponding published beta passes end-to-end consumer acceptance.
- Releases run through `.github/workflows/release.yml` and npm Trusted Publishing. Do not use manual `npm publish` as the normal path.
- A normal package metadata change must not publish. The release workflow requires a `main` commit that changes `package.json` and starts with `chore(release):`.
- Prepare each release in a dedicated PR after the product changes are merged and accepted.
- Update `CHANGELOG.md` and user-facing docs before the release version is finalized.
- Merge only after CI passes on the exact release head.
- Never reuse or overwrite an npm version that already exists.
- Keep `package.json` repository metadata aligned with `jhomra21/bgcut` because npm Trusted Publishing checks repository identity.
- The npm package must include `skills/bgcut/SKILL.md`.
- When CLI syntax, formats, provider behavior, caching, privacy behavior, or install commands change, update `README.md`, `skills/bgcut/SKILL.md`, tests, and the changelog together.
- `scripts/package/smoke.ts` must verify the installed command and bundled skill from the packed tarball.
- See `docs/operations/releasing.md` for the release procedure.

## Reference codebases

Use these repositories to study concrete implementations. Do not copy their architecture by default.

### Diffusion Studio

Repositories:

- `diffusionstudio/editor`
- Diffusion Studio `monorepo-new` when it is available through authorized access

Use it for editor architecture, media pipelines, worker boundaries, rendering, export, and performance-sensitive interactions.

### DialKit

Repository: `joshpuckett/dialkit`

Use it for compact live controls, Solid integrations, and parameter editing patterns.

### OpenCode v2

Repository: `anomalyco/opencode`

Use it for Solid application structure, persistence, preferences, commands, and separation between UI state and runtime services.

### Solid Primitives

Repository: `solidjs-community/solid-primitives`

Check it before inventing a general Solid helper for browser APIs, persistence, lifecycle, or cleanup.

### DAW Browser Convex

Repository: `jhomra21/daw-browser-convex`

Use it for worker architecture, realtime processing, high-frequency state, and editor/runtime separation.

### Pi

Repository: `earendil-works/pi`

Use it as a reference for small interfaces, explicit capabilities, and code that remains easy to follow.

## Reference policy

When designing a subsystem:

1. Find the closest relevant pattern in the reference repositories.
2. Understand why that pattern exists.
3. Implement only what bgcut needs.
4. Do not add an abstraction because another project has one.
5. Reimplement ideas for this repository instead of copying code blindly.
6. When references disagree, prefer fewer concepts, clear ownership, strong types, and straightforward tests.
7. Benchmark GPU and inference decisions instead of assuming they are faster.
