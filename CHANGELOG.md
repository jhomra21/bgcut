# Changelog

All notable user-facing changes to bgcut are recorded here.

bgcut is currently in beta. Beta releases use the npm `beta` dist-tag and GitHub prereleases. A stable release has not been declared yet.

## Unreleased

- Added repository-driven npm trusted publishing and GitHub release automation.
- Added a self-contained Agent Skills-format `bgcut` skill to the npm package.
- Added package smoke coverage that verifies the bundled skill after a clean external install.
- Refreshed beta installation, release-channel, AVIF, privacy, and runtime documentation.

## 0.1.0-beta.1 — 2026-09-17

- Added content-based AVIF decoding to the native CLI, including AVIF payloads whose filename has the wrong extension.
- Added AVIF support to the browser source and BG0 comparison pickers.
- Kept the existing native WebGPU-first execution path and CPU fallback unchanged.
- Added regression coverage for AVIF bytes stored under a misleading `.jpg` filename.

## 0.1.0-beta.0 — 2026-09-17

- First public npm beta under the `bgcut` package and command name.
- Added the native CLI with automatic WebGPU selection and CPU fallback.
- Added PNG, lossless WebP, and white-flattened JPEG output.
- Added verified local model caching and source-resolution output.
- Added browser WebGPU inference with WebAssembly fallback.
- Added the local BG0 comparison slider for visual acceptance.
