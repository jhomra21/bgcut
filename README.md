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

`--json` does not open a browser. It prints the resolved URL, host, port, and PID as one JSON object. Without `--port`, the operating system chooses an available port:

```sh
bgcut serve --json
```

The local server only binds to the loopback interface. Its UI contains the bgcut remover only; the hosted Docs, GitHub navigation, Privacy, and Terms links stay on `bgcut.dev`. The server exposes the validated model artifacts at `/models/...`, the installed ONNX Runtime files at `/runtime/...`, and a small `/health` endpoint. Non-root app routes redirect to `/`. Source images remain in the browser.

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

Native CLI and Node runs use the validated FP32 BiRefNet Lite 512 model, about 187 MiB. The packaged local browser app uses the same operating-system cache directory. Safari WebGPU on adapters that expose `shader-f16` may also download the validated internal-FP16 model, about 94 MiB, under its own filename. bgcut verifies each artifact before use and reuses valid cached copies.

Model downloads send model data to the machine. They do not send source images away from the machine.

## Browser app

The production domain is [`bgcut.dev`](https://bgcut.dev).

The browser keeps inference local. Safari WebGPU uses the validated internal-FP16 model with FP32 public tensor input and output when the adapter exposes `shader-f16`; otherwise it keeps the validated FP32 model. Chromium-family WebGPU and the WebAssembly fallback also continue to use the FP32 model. If WebGPU inference cannot run, the browser can use ONNX Runtime WebAssembly instead.

Choose, drag, or paste an image in the browser. bgcut removes the background locally, then lets you compare the original with the result, copy or download the PNG, rerun removal, or choose another image. The normal UI does not show internal runtime checks, model metadata, timing tables, or acceptance controls.

Use `Command/Ctrl+O` to choose an image and `Command/Ctrl+V` to paste one. `N` chooses a new image, `C` copies the PNG, `D` downloads it, and `R` reruns removal. When the comparison slider is focused, the left and right arrow keys move it.

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

Install bgcut:

```sh
npm install bgcut
```

For one image, use `removeBackground()`. It creates the runtime, removes the background, and closes the runtime before returning:

```ts
import { writeFile } from "node:fs/promises";
import { removeBackground } from "bgcut";

const result = await removeBackground("photo.jpg");
await writeFile("photo-nobg.png", result.data);
```

Pass output format or engine preferences only when you need them:

```ts
const result = await removeBackground("photo.jpg", {
  format: "webp",
  engine: "cpu",
});
```

For several images, create one bgcut instance and reuse its ONNX Runtime session:

```ts
import { writeFile } from "node:fs/promises";
import { createBgcut } from "bgcut";

const bgcut = await createBgcut();

try {
  const first = await bgcut.remove("first.jpg");
  const second = await bgcut.remove("second.jpg", { format: "webp" });

  await writeFile("first-nobg.png", first.data);
  await writeFile("second-nobg.webp", second.data);
} finally {
  await bgcut.close();
}
```

`createBgcut({ engine: "gpu" })` requires native WebGPU, `engine: "cpu"` requires CPU, and the default `"auto"` mode falls back to CPU if the WebGPU session cannot start. Inputs can be file paths, `Uint8Array`, or `ArrayBuffer`.

`removeBackground()` returns the encoded bytes, source width and height, and output format. The reusable `createBgcut()` path also exposes selected-engine, fallback, and timing diagnostics.

Node API failures use one public error type:

```ts
import { BgcutError, removeBackground } from "bgcut";

try {
  await removeBackground("photo.jpg");
} catch (error) {
  if (error instanceof BgcutError) {
    console.error(error.code, error.message);
  }
}
```

`BgcutError.code` is one of `model`, `engine`, `input`, `inference`, `output`, or `closed`.

## Agent skill

For a concise machine-readable public reference, start with [`bgcut.dev/llms.txt`](https://bgcut.dev/llms.txt). It links the canonical docs, package, repository, type declarations, and agent skill.

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

The production web target uses Cloudflare Workers Static Assets for the app shell and private R2 for the pinned ONNX model artifacts plus the discrete ONNX Runtime files. The Worker keeps `/models/...` and `/runtime/...` same-origin at `bgcut.dev`. Cloudflare Static Assets do not carry either model or the discrete ONNX Runtime payloads.

Run the local Cloudflare path without deploying anything:

```sh
bun run cloudflare:r2:local
bun run cloudflare:dry-run
bun run cloudflare:runtime:smoke
bun run cloudflare:dev
```

See [deployment guide](docs/operations/deploying.md) for the exact local checks, one-time R2 setup, and production command.

## Releases

Releases run through `.github/workflows/release.yml` and npm Trusted Publishing.

See [release guide](docs/operations/releasing.md) for the release process. Release history is published from the same [`CHANGELOG.md`](CHANGELOG.md) source at [bgcut.dev/changelog](https://bgcut.dev/changelog), so the website and GitHub release notes use the same wording.

## Model

Both runtime artifacts derive from `studioludens/birefnet-lite-512` revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`. Inference uses a 512x512 model input and exports at the original source dimensions.

The FP32 artifact remains the native Node/CLI model, the Chromium-family WebGPU model, and the browser WebAssembly fallback:

- File: `birefnet-lite-512-ort-basic-webgpu-v2.onnx`
- Size: `195,872,736` bytes
- SHA-256: `4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c`

Safari WebGPU adapters that expose `shader-f16` use an internal-FP16 conversion with FP32 public tensor input and output:

- File: `birefnet-lite-512-ort-basic-webgpu-v2-fp16.onnx`
- Size: `98,572,669` bytes
- SHA-256: `37d4035765b97a0323729fdee787d16eb7238c39c467316e887c5292792f3e33`

## Project notes

[benchmark notes](docs/engineering/benchmarks.md) records measured runtime results, including the Safari FP16 acceptance gate. [graph-capture notes](docs/engineering/graph-capture.md) records the earlier graph-capture work used by the Chromium-family browser path. [roadmap](docs/roadmap.md) tracks planned engine and editor work. [deployment guide](docs/operations/deploying.md) covers the Cloudflare web deployment.

## Privacy

Source images, decoded pixels, masks, and generated outputs stay on the user's machine. Cloudflare Workers serves the hosted app, model artifacts, and ONNX Runtime files. bgcut.dev does not receive source images or run image inference for the user.


## License

bgcut's original source code is licensed under the [MIT License](LICENSE).

Third-party dependencies, vendored code, ONNX Runtime components, and model artifacts remain subject to their own licenses and terms.
