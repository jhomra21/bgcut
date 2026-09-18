# Changelog

User-facing changes to bgcut are listed here.

Stable bgcut releases use the npm `latest` tag and normal GitHub releases. Prereleases use explicit prerelease tags such as `beta`.

## Unreleased

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
