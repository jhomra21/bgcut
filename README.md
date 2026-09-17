# bgcut

Local background removal with a browser WebGPU path and a native CLI.

> **Beta:** bgcut is currently prerelease software. Install the npm `beta` channel explicitly for now. Stable releases will use the normal `latest` channel once the browser UI and product contract are ready.

The browser implementation uses a pinned BiRefNet Lite 512 ONNX model with ONNX Runtime WebGPU, shares one application-owned `GPUDevice` with TypeGPU, captures the inference graph, and exports transparent PNGs at the source image resolution. The native CLI uses ONNX Runtime Node with native WebGPU first and CPU fallback in automatic mode.

Source images are processed locally. They are not uploaded to an application inference backend.

## Install the beta

The CLI currently runs on Bun, so install Bun before installing or invoking `bgcut`.

For a one-off run:

```sh
bunx bgcut@beta photo.jpg
```

Install globally with npm:

```sh
npm install -g bgcut@beta
bgcut photo.jpg
```

Or install globally with Bun:

```sh
bun add -g bgcut@beta
bgcut photo.jpg
```

During the beta period, prefer `@beta` in install commands rather than relying on npm `latest`.

## CLI

The default output is a transparent PNG next to the input:

```sh
bgcut photo.jpg
```

Choose an output path or format:

```sh
bgcut photo.jpg -o portrait.png
bgcut photo.jpg --png
bgcut photo.jpg --webp
bgcut photo.jpg --jpg
bgcut photo.jpg -webp -o portrait.webp
```

The format itself is the option; there is deliberately no `--format png` syntax. Compact aliases such as `-png`, `-webp`, and `-jpg` are supported.

PNG is the default. WebP is encoded losslessly with transparency. JPG/JPEG has no alpha channel, so bgcut flattens the result onto white.

### Input formats

The native CLI uses content-based decoding through Sharp/libvips instead of trusting the filename extension. The supported contract is:

- JPEG
- PNG
- WebP
- AVIF

An AVIF payload can still work even when its filename incorrectly ends in `.jpg`.

The browser UI accepts JPEG, PNG, WebP, and AVIF through the browser decoder.

### Engine selection

Automatic mode is the default. It tries native WebGPU first and falls back to native CPU if WebGPU session creation is unavailable:

```sh
bgcut photo.jpg
```

Require one engine for diagnostics or acceptance testing:

```sh
bgcut photo.jpg --gpu
bgcut photo.jpg --cpu
```

The compact aliases `-gpu` and `-cpu` are also supported. Explicit GPU mode does not silently fall back to CPU.

### Model cache

The first CLI run may download the pinned BiRefNet Lite 512 model, roughly 187 MiB. bgcut stores the model in the operating system user cache directory and verifies the exact artifact before use. Later runs reuse a valid cache.

The model download brings model data to the machine; it does not upload the input image.

## Browser app

The browser pipeline is:

```text
image
  -> source decode
  -> TypeGPU resize + ImageNet normalization on the shared WebGPU device
  -> BiRefNet Lite ONNX inference with WebGPU graph capture
  -> GPU output readback
  -> alpha matte
  -> source-resolution compositing
  -> transparent PNG
```

WebGPU is the preferred fast path. If WebGPU or GPU inference is unavailable, the browser can run the same pinned model through ONNX Runtime WebAssembly instead. Image pixels remain local in either path.

The model artifact is verified by exact byte count and SHA-256 during production builds.

## BG0 comparison

After the browser removes a background, the result uses a draggable comparison slider. By default it compares the original image with bgcut's result.

Use **Load BG0 output** to select a BG0 result from disk. The reference stays local and must have the same width and height as bgcut's output so the two results remain pixel-aligned while dragging the divider.

This is intended for visual acceptance of hair, fur, whiskers, thin edges, holes, and semi-transparent boundaries. It complements rather than replaces numeric matte regression tests.

## Agent skill

The npm package ships a self-contained Agent Skills-format skill at:

```text
skills/bgcut/SKILL.md
```

It documents the supported commands, formats, engine behavior, privacy boundary, model caching, and failure-handling rules an agent needs to use bgcut without fetching instructions from a separate skill repository.

Agent-skill tooling that understands the conventional `skills/<name>/SKILL.md` layout can discover or install that file from the package. The skill is also readable directly from an installed `node_modules/bgcut/skills/bgcut/SKILL.md`.

## Development

```sh
bun install --frozen-lockfile
bun run dev
```

Run the native CLI from a source checkout with:

```sh
bun run cli -- photo.jpg
```

Run the complete project gate with:

```sh
bun run check
```

That runs oxlint, TypeScript, product tests, the production build, npm package inspection, and a clean external package smoke test. The smoke test verifies the installed `bgcut` executable and the bundled agent skill.

Vendored anti-slop maintainer tests are excluded from Bun's project-level test discovery through `bunfig.toml` because Oxlint `RuleTester` expects its upstream Node/tsx environment.

## Releases

Releases are repository-driven. npm publication uses GitHub Actions trusted publishing with OIDC, so the release workflow does not need a long-lived npm write token.

Current policy:

- prerelease versions such as `0.1.0-beta.1` publish to npm `beta` and become GitHub prereleases;
- stable versions publish to npm `latest` and become normal GitHub releases;
- stable is intentionally deferred while the browser UI is still being brought to the intended product state.

See [`RELEASING.md`](RELEASING.md) for the release contract and [`CHANGELOG.md`](CHANGELOG.md) for release history.

## Model

- Model: `studioludens/birefnet-lite-512`
- Revision: `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`
- Validated runtime artifact: `birefnet-lite-512-ort-basic-webgpu-v2.onnx`
- Artifact size: `195,872,736` bytes
- SHA-256: `4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c`
- Inference size: 512×512
- Export size: original source dimensions

## Direction

Local execution alone is not the end goal. The target is a GPU-native cutout editor with stronger refinement and editing workflows, not only a one-shot background remover.

Near-term work includes the browser UI, stronger job/cancellation APIs, quality refinement, non-destructive restore/erase editing, persistence, compatibility work, and benchmark coverage. Performance and output-quality claims should continue to be measured rather than assumed.

See [`IMPROVEMENTS.md`](IMPROVEMENTS.md) for the prioritized roadmap and [`BENCHMARKS.md`](BENCHMARKS.md) for benchmark evidence.

## Privacy

Source images, decoded pixels, masks, and generated outputs stay on the user's machine. The model is downloaded from the pinned release artifact; source images are not sent there or to an application inference backend.
