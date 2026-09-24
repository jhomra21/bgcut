# Deploying bgcut.dev

The web app deploys to Cloudflare Workers with Static Assets. Runtime payloads live in the private R2 bucket `bgcut-models` and are served by the same Worker.

The production path is Cloudflare Workers Builds connected directly to the GitHub repository. GitHub Actions validates the Cloudflare bundle, but it does not authenticate to Cloudflare or deploy production.

## Architecture

```text
GitHub: jhomra21/bgcut
  -> Cloudflare Workers Builds
     -> main: bun run build:cloudflare
              bun run cloudflare:deploy
        -> bgcut
           -> bgcut.dev
           -> Vite SPA from Workers Static Assets
           -> /models/* from private R2 bucket bgcut-models
           -> /runtime/* from private R2 bucket bgcut-models
     -> non-production branch / PR:
           bun run build:cloudflare
           bun run cloudflare:preview
           -> Worker preview URL
```

Source images never go through the Worker or R2. Browser image decoding, preprocessing, inference, compositing, and export stay on the user's device.

`wrangler.jsonc` is the deployment source of truth. It configures:

- Worker name `bgcut`
- `bgcut.dev` as a Worker Custom Domain
- `dist/` as the SPA asset directory
- SPA navigation fallback to `index.html`
- preview URLs for uploaded Worker versions
- the `MODELS` binding to the `bgcut-models` R2 bucket
- Worker-first routing for `/models/*` and `/runtime/*`

## Cloudflare Git integration

Connect the existing `bgcut` Worker to `jhomra21/bgcut` from Cloudflare Workers & Pages.

Use these build settings:

```text
Root directory: /
Production branch: main
Build command: leave blank
Deploy command: bun run cloudflare:deploy
Builds for non-production branches: enabled
Non-production branch deploy command: bun run cloudflare:preview
```

The Cloudflare-specific build is pinned in `wrangler.jsonc` through `build.command = "bun run build:cloudflare"`. Wrangler runs that custom build automatically before `deploy` and `versions upload`, so the deployment behavior stays in source control.

Do not configure Workers Builds to run the normal `bun run build` as its build command. The normal build prepares both model artifacts in `dist/`, and each exceeds the Workers Static Assets 25 MiB per-file limit. The Wrangler custom build strips R2-backed models and discrete ONNX Runtime payloads from `dist/` before assets are scanned.

Set this build variable:

```text
BUN_VERSION=1.4.2
```

Cloudflare Workers Builds creates and manages the build API token. Do not add `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` to GitHub for this deployment path.

Every production-branch push builds and deploys the Worker. Non-production branch builds upload a Worker version instead of promoting it, which lets Cloudflare attach preview status and URLs to pull requests.

The default build watch path can remain `*`. Narrow it only if deploys from documentation-only changes become noisy.

## R2 payloads

The R2 bucket stores:

- the FP32 BiRefNet Lite artifact at `/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx`
- the Safari WebGPU internal-FP16 artifact at `/models/birefnet-lite-512-ort-basic-webgpu-v2-fp16.onnx`
- ONNX Runtime's WebGPU asyncify WASM binary at `/runtime/ort-wasm-simd-threaded.asyncify.wasm`
- ONNX Runtime's standard WASM fallback binary at `/runtime/ort-wasm-simd-threaded.wasm`
- ONNX Runtime's module loader at `/runtime/ort-wasm-simd-threaded.mjs`

The FP32 model is about 187 MiB and the FP16 model is about 94 MiB. The WebGPU asyncify WASM binary is about 26.8 MiB, and the standard WASM fallback binary is about 14.2 MiB. These files stay in R2 rather than Workers Static Assets.

These objects are immutable, version-pinned deployment inputs. The FP32 model remains the existing bootstrap object. Before production and preview deploys, bgcut prepares the exact released FP16 artifact and checks its live `/models/*` HEAD route. A matching object is left in place. A missing or changed FP16 object is uploaded to R2 with bounded retries. The deploy performs the same check-and-upload flow for the three ONNX Runtime files.

The Worker reads them through the `MODELS` R2 binding, so the Worker itself does not contain R2 credentials. Cloudflare Workers Builds supplies the deployment credential; its default token includes Workers R2 Storage edit access.

## Local Cloudflare test

Install dependencies:

```sh
bun install --frozen-lockfile
```

Seed Wrangler's local R2 storage with both models and the ONNX Runtime files:

```sh
bun run cloudflare:r2:local
```

Build the exact static payload Cloudflare receives:

```sh
bun run build:cloudflare
```

Run Wrangler's deploy compilation without uploading anything:

```sh
bun run cloudflare:dry-run
```

Run the real local Worker and R2 route smoke:

```sh
bun run cloudflare:runtime:smoke
```

Start the Worker and local R2 simulation:

```sh
bun run cloudflare:dev
```

Use the local URL printed by Wrangler, normally `http://localhost:8787`.

Check the page, model routes, and runtime routes:

```sh
curl -I http://localhost:8787/
curl -I http://localhost:8787/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx
curl -I http://localhost:8787/models/birefnet-lite-512-ort-basic-webgpu-v2-fp16.onnx
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.asyncify.wasm
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.wasm
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.mjs
```

Both WASM routes must return `content-type: application/wasm`. The module loader must return JavaScript rather than SPA HTML. Both model routes must return `application/octet-stream` rather than SPA HTML.

Then open the local site in Safari on a WebGPU adapter that exposes `shader-f16` and run the normal WebGPU path. Open it in a Chromium-family browser and run normal WebGPU plus explicit WebAssembly. The capable Safari request should use the FP16 filename; Chromium WebGPU and WebAssembly should use the FP32 filename.

## Remote R2 bootstrap or payload update

`bun run cloudflare:deploy` and `bun run cloudflare:preview` prepare and validate the released FP16 model before checking R2. They skip the remote object when its size, content type, and ETag match. A changed or missing FP16 object is uploaded with retry/backoff. The three ONNX Runtime files use the same check-and-upload pattern.

The FP32 model remains an operator bootstrap object for a new R2 bucket. Existing installations keep using the validated object already stored under its pinned filename.

Authenticate Wrangler on an operator machine:

```sh
bunx wrangler@4.135.0 login
```

Create the bucket only if it does not already exist:

```sh
bunx wrangler@4.135.0 r2 bucket create bgcut-models
```

Prepare the exact validated models:

```sh
bun run model:prepare
```

Bootstrap the FP32 model only when the bucket does not already contain the validated object:

```sh
bunx wrangler@4.135.0 r2 object put \
  bgcut-models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --file public/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --content-type application/octet-stream \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote
```

Ensure the Safari FP16 model is current with the same command used by deploys:

```sh
bun run cloudflare:model:remote
```

Upload the pinned ONNX Runtime files:

```sh
bunx wrangler@4.135.0 r2 object put \
  bgcut-models/ort-wasm-simd-threaded.asyncify.wasm \
  --file node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm \
  --content-type application/wasm \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote

bunx wrangler@4.135.0 r2 object put \
  bgcut-models/ort-wasm-simd-threaded.wasm \
  --file node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm \
  --content-type application/wasm \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote

bunx wrangler@4.135.0 r2 object put \
  bgcut-models/ort-wasm-simd-threaded.mjs \
  --file node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs \
  --content-type text/javascript \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote
```

Verify both models:

```sh
bunx wrangler@4.135.0 r2 object get \
  bgcut-models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --remote \
  --pipe | shasum -a 256

bunx wrangler@4.135.0 r2 object get \
  bgcut-models/birefnet-lite-512-ort-basic-webgpu-v2-fp16.onnx \
  --remote \
  --pipe | shasum -a 256
```

Expected SHA-256 values:

```text
4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c
37d4035765b97a0323729fdee787d16eb7238c39c467316e887c5292792f3e33
```

## Production verification

After a successful Cloudflare production build:

```sh
curl -I https://bgcut.dev/
curl -I https://bgcut.dev/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx
curl -I https://bgcut.dev/models/birefnet-lite-512-ort-basic-webgpu-v2-fp16.onnx
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.asyncify.wasm
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.wasm
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.mjs
```

Run a real removal in Safari on a WebGPU adapter that exposes `shader-f16` and confirm that the request uses the FP16 model path. Run Chromium WebGPU and browser WebAssembly checks and confirm that they still use the FP32 model path before treating the production change as accepted.

## CI gate

`.github/workflows/cloudflare.yml` builds the Cloudflare payload and runs `wrangler deploy --dry-run` plus the local R2 runtime smoke on pull requests and pushes to `main`. It never deploys production resources.

`.github/workflows/ci.yml` runs the full repository check on pull requests and on `main`. Feature-branch pushes do not run a second duplicate CI job when a pull request is already open.

The production deployment is owned by Cloudflare Workers Builds. The npm release workflow remains separate.

## Observability

Keep the desired Worker observability policy in `wrangler.jsonc`:

- Workers Logs enabled
- invocation logs enabled
- log persistence enabled
- automatic traces enabled
- trace persistence enabled
- real-time Issues enabled
- 100% log and trace sampling while traffic is low
- query-string redaction enabled

`wrangler.jsonc` is the intended source of truth. A normal deployment should leave the Cloudflare dashboard consistent with that configuration. If the dashboard and the deployed config disagree, treat that as configuration drift or a Workers Builds/Wrangler synchronization problem rather than as a required second configuration step.

Dashboard changes show the equivalent Wrangler snippet. If a setting is changed manually while diagnosing drift, keep the committed `wrangler.jsonc` equivalent so the repository still records the intended state.

Cloudflare Workers Builds manages its deployment credential internally. Do not add a Cloudflare token to GitHub solely to patch observability settings after deployment.

After changes, verify the dashboard shows Logs and Traces enabled and exercise `bgcut.dev` so Events, Invocations, and Traces receive data.
