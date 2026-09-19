<img
  src="https://raw.githubusercontent.com/jhomra21/bgcut/main/docs/images/bgcut-lockup.svg"
  alt="bgcut"
  width="292"
/>

Remove image backgrounds locally from the hosted web app, the installed local app, the CLI, or the Node API.

<a href="https://bgcut.dev">
  <img
    src="https://raw.githubusercontent.com/jhomra21/bgcut/main/docs/images/bgcut-ui.webp"
    alt="bgcut browser UI showing local background removal and before-and-after comparison"
    width="100%"
  />
</a>

Source images stay on the user's machine. bgcut does not upload them to an application inference backend.

## Install

Run the local app without installing globally:

```sh
npx bgcut
```

Or install bgcut globally:

```sh
npm install -g bgcut
bgcut
```

Bun users can use the same package:

```sh
bunx bgcut
```

The published executable is built for Node. Bun is used to develop and build the repository, but npm and npx users do not need Bun installed to run bgcut.

## Local app

Running `bgcut` with no image starts the packaged bgcut web UI on `127.0.0.1` using an available port and opens it in your browser:

```sh
bgcut
```

The explicit form is:

```sh
bgcut serve
```

Use a fixed port or keep the browser closed when integrating with another process:

```sh
bgcut serve --port 8787
bgcut serve --no-open
```

For process discovery, `--json` selects an available port, does not open a browser, and prints the resolved URL, host, port, and PID as one JSON object:

```sh
bgcut serve --json
```

The local server only binds to the loopback interface. It serves the same browser UI as `bgcut.dev`, the cached validated model at `/models/...`, the installed ONNX Runtime files at `/runtime/...`, and a small `/health` endpoint. Source images remain in the browser.

## CLI

Passing an image keeps the headless file-in/file-out behavior:

```sh
bgcut photo.jpg
```

The explicit command is also available:

```sh
bgcut remove photo.jpg
```

The default command writes a transparent PNG next to the input image. Choose the output path with `-o` or `--output`:

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

The first native run may download the pinned BiRefNet Lite 512 ONNX model, about 187 MiB. bgcut stores it in the operating system user cache and verifies the expected artifact before use. The CLI, packaged local app, and Node API share that validated cache, so later runs reuse a valid copy.

The model download sends model data to the machine. It does not send source images away from the machine.

## Browser app

The production domain is [`bgcut.dev`](https://bgcut.dev).

The browser uses the same pinned model and keeps inference local. WebGPU is the primary path. If WebGPU inference cannot run, the browser can use ONNX Runtime WebAssembly instead.

The product UI follows one small flow: click or drop an image, wait for local removal, compare the original with the result, then copy, download, redo, or choose a new image. Runtime checks, model details, timing tables, and internal acceptance controls stay out of the normal UI.

Keyboard shortcuts mirror the result actions: `N` chooses a new image, `C` copies the result, `D` downloads it, and `R` reruns removal. When the comparison slider is focused, the native left and right arrow keys move it.

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


## Node API

Install bgcut as an application dependency:

```sh
npm install bgcut
```

The package exposes the same native removal engine for applications and scripts. A created engine downloads and verifies the pinned model if needed, creates one ONNX Runtime session, and reuses that session across removals until it is closed.

```ts
import { writeFile } from "node:fs/promises";
import { createBgcut } from "bgcut";

const bgcut = await createBgcut();

try {
  const result = await bgcut.remove("photo.jpg", { format: "png" });
  await writeFile("photo-nobg.png", result.data);
} finally {
  await bgcut.close();
}
```

`createBgcut({ engine: "gpu" })` requires native WebGPU, `engine: "cpu"` requires CPU, and the default `"auto"` mode falls back to CPU if the WebGPU session cannot start. Inputs can be file paths, `Uint8Array`, or `ArrayBuffer`.

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

`bun run check` runs oxlint, TypeScript, tests, the production build, package inspection, and a clean package install test. The package test installs the packed tarball and verifies the Node CLI, packaged local web app and health route, Node API export, and bundled agent skill.

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


## License

bgcut's original source code is licensed under the [MIT License](LICENSE).

Third-party dependencies, vendored code, ONNX Runtime components, and model artifacts remain subject to their own licenses and terms.
