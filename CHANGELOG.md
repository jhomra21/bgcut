# Changelog

User-facing changes to bgcut are listed here.

bgcut is in beta. Beta releases use the npm `beta` tag and GitHub prereleases. No stable release exists yet.

## Unreleased

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
