# Changelog

User-facing changes to bgcut are listed here.

Stable bgcut releases use the npm `latest` tag and normal GitHub releases. Prereleases use explicit prerelease tags such as `beta`.

## Unreleased

## 0.4.0 - 2026-09-21

- Promoted the accepted 0.4 beta line to stable after clean installed-package validation of the one-shot Node API, reusable WebGPU sessions, public error contract, CLI inference, packaged local app, health route, and model delivery.
- Added `removeBackground(input, options?)` for one-shot Node.js removal while keeping `createBgcut()` for reusable sessions and batch work.
- Added the public `BgcutError` contract with stable `model`, `engine`, `input`, `inference`, `output`, and `closed` codes, including direct malformed-input errors through both Node API paths.
- Shipped the shared Documentation/Changelog reference layout, search-discovery improvements, accessibility contrast work, static-asset security/cache headers, and the simplified 75ms fade-out plus 75ms fade-in title handoff.
- Hardened Cloudflare runtime deployment around unchanged R2 assets, transient upload failures, and post-upload verification.

## 0.4.0-beta.2 - 2026-09-21

- Replaced the Documentation/Changelog title morph with a simple two-phase handoff: the current title fades out for 75ms, then the title at the destination fades in for 75ms. The page and rail titles keep their own fixed layout positions, so the handoff no longer depends on measured coordinates or font-size interpolation.
- Hardened Cloudflare production deploys so pinned ONNX Runtime assets are checked through the live runtime routes, unchanged objects skip R2 uploads, and changed or missing objects retry transient R2 failures before the deploy fails.
- Moved the compact Documentation/Changelog title into the shared reading rail, removed the sticky header border, and kept the bgcut brand plus Docs/Changelog/GitHub navigation pinned while reference pages scroll.
- Moved Docs and Changelog section tracking into the upper third of the viewport and reused the same reading rail, scroll tracking, click scrolling, reduced-motion behavior, and responsive layout on both pages.
- Unified the Docs and Changelog page shell so title placement, typography, content width, section spacing, separators, and rail geometry stay consistent.
- Simplified the Documentation page header and public Changelog presentation, including keeping `Unreleased` notes out of the hosted changelog.
- Stabilized the Docs/Changelog/GitHub switcher so changing routes does not alter tab width, and added the shared sliding active-tab indicator.
- Improved search discovery with route-specific metadata, canonical URLs, a focused sitemap, WebApplication structured data, and `llms.txt`. The hosted app also defers the browser inference stack until image selection.
- Raised secondary text contrast to WCAG AA and added Cloudflare Static Assets security headers plus immutable caching for fingerprinted assets.

## 0.4.0-beta.1 - 2026-09-20

- Fixed the Node API error boundary so documented `BgcutError` instances reach callers directly instead of being wrapped as Effect `FiberFailure` objects. Malformed image bytes now reject with `BgcutError` and code `input` from both `removeBackground()` and reusable `createBgcut()` instances.
- Added packed-package regression coverage for malformed-image errors through both public Node API paths, while retaining the existing closed-instance error check.

## 0.4.0-beta.0 - 2026-09-20

- Added a one-shot Node API, `removeBackground(input, options?)`, for the common single-image case. It returns only encoded image data, dimensions, and format, while `createBgcut()` remains the reusable session path with runtime diagnostics for batch work.
- Added the public `BgcutError` type with stable error codes so callers can handle model, engine, input, inference, output, and closed-instance failures without depending on Effect or ONNX Runtime internals.
- Updated the hosted and repository documentation for the new Node API and added `/changelog` to bgcut.dev, rendered directly from `CHANGELOG.md` so the website and GitHub release notes share one source of truth.
- This beta is for published-package validation before 0.4.0 stable. The background-removal model, CLI syntax, browser inference path, and output behavior are unchanged.

## 0.3.2 - 2026-09-20

- Reorganized the repository around explicit app, browser, CLI, Node, native, shared, Worker, documentation, and tooling directories while keeping the published CLI and Node API behavior intact.
- Split the browser application into focused pages, navigation, and shared site chrome, and kept the accepted documentation scrollspy fix so section highlighting follows the reader more accurately.
- Moved engineering, operations, roadmap, model, package, Cloudflare, and brand files into clearer locations and added repository-layout checks to prevent old boundaries from creeping back in.
- Tightened the repository's anti-slop guidance and kept the vendored anti-slop rules current and enforced through oxlint.
- Removed the obsolete Cloudflare observability setting that Wrangler no longer supports and aligned the runtime smoke path with Wrangler 4.135.0.
- No background-removal model, inference algorithm, CLI command syntax, Node API contract, or packaged local-app workflow changed in this release.

## 0.3.1 - 2026-09-19

- Promoted the accepted `0.3.1-beta.0` package to stable after published-package validation of the packaged local shell, image removal, comparison slider, clipboard and paste actions, keyboard shortcuts, file download, health endpoint, and local route redirects.
- The packaged local app now shows only the bgcut brand and removal workflow, while Docs, GitHub navigation, Privacy, Terms, and the site footer remain on `bgcut.dev`.
- Non-root local app routes redirect to `/` while `/health`, `/models/...`, and `/runtime/...` remain available to the packaged app.
- `bgcut.dev` remains the full hosted site with Docs/GitHub navigation, Privacy and Terms pages, footer links, and section-aware documentation navigation.
- No background-removal model, inference algorithm, CLI command syntax, or Node API contract changed from the accepted beta.

## 0.3.1-beta.0 - 2026-09-19

- Separated the packaged local app from the hosted website: `bgcut` and `bgcut serve` now show only the bgcut brand and background-removal workflow, without Docs, GitHub, Privacy, Terms, or the hosted footer.
- Kept the local app root-only by redirecting non-root app routes such as `/docs`, `/privacy`, and `/terms` back to `/`, while preserving the local health, model, and ONNX Runtime routes.
- Added an explicit local-runtime marker from the loopback server so the packaged app does not rely on hostname detection, and extended the packed npm consumer smoke to verify that contract.
- Expanded `bgcut.dev` into the full hosted site with shared navigation, documentation, Privacy and Terms pages, footer links, and section-aware docs navigation.
- Updated the website copy, README, packaged agent skill, and release documentation to match the current CLI, Node API, model/runtime, local-app, privacy, and licensing behavior.
- No background-removal model, inference algorithm, CLI command syntax, or Node API contract changed in this beta.

## 0.3.0 - 2026-09-18

- Promoted the accepted `0.3.0-beta.0` package to stable after end-to-end consumer validation of npm installation, the packaged local UI, result actions, the headless CLI, and `serve --json`.
- Added the packaged local web app: `bgcut` or `bgcut serve` starts the browser UI on loopback with JSON startup discovery, local health checks, the validated model route, and installed ONNX Runtime assets.
- Published the CLI as a Node executable so npm and npx users do not need Bun.
- Added the reusable `createBgcut()` Node API with automatic, GPU, and CPU engine selection plus ONNX Runtime session reuse across removals.
- Shared one validated native model cache across the local app, CLI, and Node API while keeping the large BiRefNet model out of the npm tarball.
- Added browser keyboard shortcuts for New Image, Copy, Download, and Redo, plus native left/right keyboard control for the comparison slider.
- Expanded the packaged agent skill, README, release instructions, package metadata, and smoke coverage to match the full 0.3 public surface.

## 0.3.0-beta.0 - 2026-09-18

- Added the packaged local web app: `bgcut` or `bgcut serve` starts the accepted browser UI on loopback, with JSON startup discovery, local health checks, the validated model route, and installed ONNX Runtime assets.
- Added browser keyboard shortcuts for New Image, Copy, Download, and Redo, plus native left/right keyboard control for the comparison slider.
- Published the CLI as a Node executable so npm and npx users do not need Bun, including Node-compatible model-cache inspection and validation.
- Added the reusable `createBgcut()` Node API with automatic/GPU/CPU engine selection, shared validated model caching, and ONNX Runtime session reuse across removals.
- Kept the large BiRefNet model out of the npm tarball while sharing the same validated local cache across the local app, CLI, and Node API.
- Strengthened the packed-package release gate with real installed Node CLI inference and two removals through one reusable Node API engine.
- Corrected the bundled agent skill so its install guidance matches the Node-native published package.

## 0.2.1 - 2026-09-18

- Replaced the renderer-dependent README icon/title alignment with one pre-aligned bgcut lockup so the brand header renders consistently on GitHub and npm.
- No runtime, inference, CLI, model, or web-app behavior changed.

## 0.2.0 - 2026-09-18

- Promoted the accepted `0.2.0-beta.0` build to the stable `latest` channel with no runtime or inference changes.
- Updated npm-facing documentation and the bundled agent skill to use stable install commands.
- Kept the production `bgcut.dev` Cloudflare Worker, private R2 model/runtime delivery, observability, branding, metadata, and repository cleanup from `0.2.0-beta.0`.

## 0.2.0-beta.0 - 2026-09-18

- Shipped the production `bgcut.dev` experience on Cloudflare Workers with the BiRefNet model and ONNX Runtime payloads served same-origin from private R2.
- Hardened Cloudflare deployment so the pinned runtime files are seeded before production deploys and local/CI smoke checks verify the Worker and R2 routes.
- Added Worker observability configuration for logs, invocation logs, traces, Issues, persistence, 100% sampling during beta traffic, and query-string redaction.
- Added the approved bgcut brand mark across the in-app header, favicon, Apple touch icon, web app icons, manifest, and social preview.
- Added canonical, search, Open Graph, Twitter, robots, sitemap, and structured metadata for `bgcut.dev`.
- Branded the repository README with the bgcut icon and a live product screenshot, with image URLs that also render correctly on npm.
- Cleaned stale repository infrastructure and documentation, closed obsolete benchmark PRs, removed duplicate feature-branch CI runs, and aligned deployment docs with the current R2 architecture.

## 0.1.0-beta.2 - 2026-09-17

- Added repository-driven npm Trusted Publishing and GitHub release automation.
- Added a self-contained `bgcut` agent skill to the npm package.
- Added package tests that verify the installed CLI and bundled skill from a packed tarball.
- Updated the beta install, AVIF, privacy, runtime, and release documentation.
- Removed internal comparison-tool references from public documentation.
- Simplified the browser UI to the accepted flow: click or drag an image, run removal automatically, compare the result, then copy, download, redo, or choose a new image.
- Removed runtime diagnostics, timing tables, model details, and internal reference-image controls from the normal product UI.
- Added the Cloudflare Workers deployment path for `bgcut.dev`, with Workers Static Assets limited to the app payload.
- Moved the BiRefNet model, ONNX Runtime WebGPU WASM binary, fallback WASM binary, and module loader to private R2 behind same-origin Worker routes.
- Added Cloudflare build guards so discrete ONNX Runtime runtime files cannot leak into Workers Static Assets.
- Added a real local Wrangler and R2 smoke that verifies both WASM runtime routes and the module loader.
- Added Cloudflare dry-run CI and local deployment documentation.

## 0.1.0-beta.1 - 2026-09-17

- Added content-based AVIF decoding to the CLI, including AVIF data stored in a file whose name ends in `.jpg`.
- Added AVIF support to the browser source and reference-image pickers.
- Kept the existing WebGPU-first CLI behavior and CPU fallback.
- Added a regression test for mislabeled AVIF input.

## 0.1.0-beta.0 - 2026-09-17

- Published the first npm beta under the `bgcut` package and command name.
- Added the native CLI with automatic WebGPU selection and CPU fallback.
- Added PNG, lossless WebP, and white-background JPEG output.
- Added verified local model caching and source-resolution output.
- Added browser WebGPU inference with WebAssembly fallback.
- Added a local browser comparison slider for result inspection.
