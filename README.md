<img
  src="https://raw.githubusercontent.com/jhomra21/bgcut/main/docs/images/bgcut-lockup.svg"
  alt="bgcut"
  width="292"
/>

Remove image backgrounds locally in the browser or from the command line.

<a href="https://bgcut.dev">
  <img
    src="https://raw.githubusercontent.com/jhomra21/bgcut/main/docs/images/bgcut-ui.webp"
    alt="bgcut browser UI showing local background removal and before-and-after comparison"
    width="100%"
  />
</a>

Source images stay on the user's machine. bgcut does not upload them to an application inference backend.

## Install

The CLI currently runs on Bun.

Run it without installing globally:

```sh
bunx bgcut photo.jpg
```

Or install the beta globally:

```sh
npm install -g bgcut
bgcut photo.jpg
```

Bun can install it globally too:

```sh
bun add -g bgcut
bgcut photo.jpg
```

## CLI

The default command writes a transparent PNG next to the input image:

```sh
bgcut photo.jpg
```

Choose the output path with `-o` or `--output`:

```sh
bgcut photo.jpg -o portrait.png
```

Choose an output format with the format flag itself:

```sh
bgcut photo.jpg --png
bgcut photo.jpg --webp
bgcut photo.jpg --jpg
```

Compact aliases also work:

```sh
bgcut photo.jpg -png
bgcut photo.jpg -webp
bgcut photo.jpg -jpg
```

There is no `--format png` form.

PNG is the default and preserves transparency. WebP is lossless and preserves transparency. JPG and JPEG have no alpha channel, so bgcut places the cutout on white.

### Input formats

The CLI supports JPEG, PNG, WebP, and AVIF. Sharp and libvips inspect the file contents instead of trusting the filename extension, so an AVIF file can still decode when its name ends in `.jpg`.

The browser accepts JPEG, PNG, WebP, and AVIF.

### Engine selection

Automatic mode tries native WebGPU first. If a WebGPU session cannot start, it uses the native CPU provider.

```sh
bgcut photo.jpg
```

Require one provider when testing or diagnosing a machine:

```sh
bgcut photo.jpg --gpu
bgcut photo.jpg --cpu
```

The `-gpu` and `-cpu` aliases also work. Explicit GPU mode never switches to CPU silently.

### Model cache

The first CLI run may download the pinned BiRefNet Lite 512 ONNX model, about 187 MiB. bgcut stores it in the operating system user cache and verifies the expected artifact before use. Later runs reuse a valid cached copy.

The model download sends model data to the machine. It does not send source images away from the machine.

## Browser app

The production domain is [`bgcut.dev`](https://bgcut.dev).

The browser uses the same pinned model and keeps inference local. WebGPU is the primary path. If WebGPU inference cannot run, the browser can use ONNX Runtime WebAssembly instead.

The product UI follows one small flow: click or drop an image, wait for local removal, compare the original with the result, then copy, download, redo, or choose a new image. Runtime checks, model details, timing tables, and internal acceptance controls stay out of the normal UI.

The current WebGPU pipeline is:

```text
image
  -> browser decode
  -> TypeGPU resize and ImageNet normalization
  -> BiRefNet Lite ONNX inference
  -> matte readback
  -> source-resolution compositing
  -> transparent PNG
```


## Agent skill

The npm package includes a self-contained Agent Skills file:

```text
skills/bgcut/SKILL.md
```

It contains the commands, supported formats, provider behavior, model caching rules, privacy rules, and error-handling guidance needed to use bgcut. Agents do not need a separate skill repository.

After installation, the file is available at `node_modules/bgcut/skills/bgcut/SKILL.md`.

## Development

Install and start the browser app:

```sh
bun install --frozen-lockfile
bun run dev
```

Run the CLI from the checkout:

```sh
bun run cli -- photo.jpg
```

Run the complete project check:

```sh
bun run check
```

`bun run check` runs oxlint, TypeScript, tests, the production build, package inspection, and a clean package install test. The package test verifies both the `bgcut` command and the bundled agent skill.

### Cloudflare preview

The production web target uses Cloudflare Workers Static Assets for the app shell and private R2 for the ONNX model plus all discrete ONNX Runtime files: the WebGPU WASM binary, fallback WASM binary, and runtime module loader. The Worker keeps `/models/...` and `/runtime/...` same-origin at `bgcut.dev`. Cloudflare Static Assets do not carry the model or discrete ONNX Runtime payloads.

Run the local Cloudflare path without deploying anything:

```sh
bun run cloudflare:r2:local
bun run cloudflare:dry-run
bun run cloudflare:runtime:smoke
bun run cloudflare:dev
```

See [`DEPLOYING.md`](DEPLOYING.md) for the exact local checks, one-time R2 setup, and production command.

## Releases

Releases run through `.github/workflows/release.yml` and npm Trusted Publishing.

Stable versions publish to npm `latest` and create normal GitHub releases. Prerelease versions publish to their matching prerelease tag, such as `beta`.

See [`RELEASING.md`](RELEASING.md) for the release process and [`CHANGELOG.md`](CHANGELOG.md) for release history.

## Model

- Model: `studioludens/birefnet-lite-512`
- Revision: `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`
- Runtime artifact: `birefnet-lite-512-ort-basic-webgpu-v2.onnx`
- Artifact size: `195,872,736` bytes
- SHA-256: `4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c`
- Inference size: 512x512
- Export size: original source dimensions

## Project notes

[`BENCHMARKS.md`](BENCHMARKS.md) records measured runtime results. [`GRAPH_CAPTURE.md`](GRAPH_CAPTURE.md) records the graph-capture work behind the current browser fast path. [`IMPROVEMENTS.md`](IMPROVEMENTS.md) tracks planned engine and editor work. [`DEPLOYING.md`](DEPLOYING.md) covers the Cloudflare web deployment.

## Privacy

Source images, decoded pixels, masks, and generated outputs stay on the user's machine. The Cloudflare Worker serves the app shell and reads model/runtime payloads from private R2. It does not receive source images or inference requests.
