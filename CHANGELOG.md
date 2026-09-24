# Changelog

User-facing changes to bgcut are listed here.

## 0.5.0 - 2026-09-24

- Safari WebGPU now uses a reusable no-capture ONNX Runtime session and selects the validated internal-FP16 BiRefNet artifact when the WebGPU device exposes `shader-f16`. Safari without that feature, Chromium-family WebGPU, browser WebAssembly, and native Node/CLI keep FP32.
- On an Apple M3 Pro with Safari 26.3, the process-isolated six-image gate moved the pooled warm inference median from 1,101 ms with FP32 to 627.5 ms with FP16, a 43.0% reduction. The pooled warm total median moved from 1,309 ms to 873.5 ms, a 33.3% reduction.
- The Safari FP16 artifact is 98,572,669 bytes, compared with 195,872,736 bytes for FP32. Public model input and output remain FP32.
- In the same six-image gate, aggregate MAE moved from 0.02255466 to 0.02200792, MSE from 0.01933876 to 0.01876192, IoU from 0.96425259 to 0.96511045, and F1 from 0.98180101 to 0.98224550. These measurements are specific to that hardware and benchmark set.
- Added persistent light and dark site themes backed by semantic color tokens.
- Added repeatable benchmark commands for bgcut timing and output-quality scoring, with a documented comparison protocol.
- Simplified the Documentation and Changelog layout around the permanent left rail. The hosted changelog now lists only full stable releases.

## 0.4.0 - 2026-09-21

- Validated the installed package end to end across the one-shot Node API, reusable WebGPU sessions, public error contract, CLI inference, packaged local app, health route, and model delivery.
- Added `removeBackground(input, options?)` for one-shot Node.js removal while keeping `createBgcut()` for reusable sessions and batch work.
- Added the public `BgcutError` contract with stable `model`, `engine`, `input`, `inference`, `output`, and `closed` codes. Malformed image bytes reach callers through the same public error type.
- Added the shared Documentation and Changelog reference layout, route metadata, search discovery files, WCAG AA secondary text contrast, static-asset security headers, and the 75 ms fade-out plus 75 ms fade-in title handoff.
- Updated Cloudflare runtime deployment so unchanged R2 assets skip uploads, changed or missing runtime objects retry transient failures, and deployment verifies the live runtime routes.

## 0.3.2 - 2026-09-20

- Reorganized the repository around explicit app, browser, CLI, Node, native, shared, Worker, documentation, and tooling directories while keeping the published CLI and Node API behavior intact.
- Split the browser application into focused pages, navigation, and shared site chrome. The documentation scroll tracking follows the reader in the upper part of the viewport.
- Moved engineering, operations, roadmap, model, package, Cloudflare, and brand files into clearer locations and added repository-layout checks to prevent the old paths from returning.
- Kept the vendored anti-slop rules current and enforced through oxlint.
- Removed the obsolete Cloudflare observability setting that Wrangler no longer supports and aligned the runtime smoke path with Wrangler 4.135.0.
- No background-removal model, inference algorithm, CLI command syntax, Node API contract, or packaged local-app workflow changed in this release.

## 0.3.1 - 2026-09-19

- Validated the installed package across the packaged local shell, image removal, comparison slider, clipboard and paste actions, keyboard shortcuts, file download, health endpoint, and local route redirects.
- The packaged local app now shows only the bgcut brand and removal workflow. Docs, GitHub navigation, Privacy, Terms, and the site footer remain on `bgcut.dev`.
- Non-root local app routes redirect to `/` while `/health`, `/models/...`, and `/runtime/...` remain available to the packaged app.
- `bgcut.dev` remains the full hosted site with Docs and GitHub navigation, Privacy and Terms pages, footer links, and section-aware documentation navigation.
- No background-removal model, inference algorithm, CLI command syntax, or Node API contract changed in this release.

## 0.3.0 - 2026-09-18

- Validated npm installation, the packaged local UI, result actions, the headless CLI, and `serve --json` in a clean consumer environment.
- Added the packaged local web app. `bgcut` or `bgcut serve` starts the browser UI on loopback with JSON startup discovery, local health checks, the validated model route, and installed ONNX Runtime assets.
- Published the CLI as a Node executable so npm and npx users do not need Bun.
- Added the reusable `createBgcut()` Node API with automatic, GPU, and CPU engine selection plus ONNX Runtime session reuse across removals.
- Shared one validated native model cache across the local app, CLI, and Node API while keeping the large BiRefNet model out of the npm tarball.
- Added browser keyboard shortcuts for New Image, Copy, Download, and Redo, plus native left and right keyboard control for the comparison slider.
- Expanded the packaged agent skill, README, release instructions, package metadata, and smoke coverage to match the 0.3 public behavior.

## 0.2.1 - 2026-09-18

- Replaced the renderer-dependent README icon and title alignment with one pre-aligned bgcut lockup so the brand header renders consistently on GitHub and npm.
- No runtime, inference, CLI, model, or web-app behavior changed.

## 0.2.0 - 2026-09-18

- Shipped `bgcut.dev` on Cloudflare Workers with the BiRefNet model and ONNX Runtime files served from private R2 through same-origin routes.
- Added Cloudflare deployment checks for the Worker, model route, ONNX Runtime routes, security headers, and local R2 setup.
- Added the bgcut brand mark to the app header, favicon, touch icon, web app icons, manifest, social preview, repository README, and npm-facing README.
- Added canonical URLs, route metadata, Open Graph and Twitter metadata, robots.txt, sitemap.xml, and structured metadata for `bgcut.dev`.
- Updated npm-facing documentation and the bundled agent skill to use the stable install commands.
