# Changelog

User-facing changes to bgcut are listed here.

bgcut is in beta. Beta releases use the npm `beta` tag and GitHub prereleases. No stable release exists yet.

## Unreleased

- Added repository-driven npm Trusted Publishing and GitHub release automation.
- Added a self-contained `bgcut` agent skill to the npm package.
- Added package tests that verify the installed CLI and bundled skill from a packed tarball.
- Updated the beta install, AVIF, privacy, runtime, and release documentation.
- Removed internal comparison-tool references from public documentation.
- Simplified the browser UI to the sketch flow: click or drag an image, run removal automatically, compare the result, then use the integrated copy, download, redo, or new-image actions.
- Removed runtime diagnostics, timing tables, model details, and internal reference-image controls from the normal product UI.
- Added Cloudflare Workers deployment for `bgcut.dev` with the large model served from private R2 at the same `/models/...` path.
- Moved both ONNX Runtime WASM binaries to private R2 at `/runtime/...` and configured the WebGPU and fallback paths to load them explicitly.
- Added Cloudflare build guards for the 25 MiB Static Assets limit and correct `application/wasm` runtime routing.
- Added a Cloudflare dry-run CI workflow and local deployment instructions.

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
