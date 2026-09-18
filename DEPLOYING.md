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

Do not configure Workers Builds to run the normal `bun run build` as its build command. The normal build intentionally places the 187 MiB model in `dist/`, which exceeds the Workers Static Assets 25 MiB per-file limit. The Wrangler custom build strips the R2-backed model and discrete ONNX Runtime payloads from `dist/` before assets are scanned.

Set this build variable:

```text
BUN_VERSION=1.4.2
```

Cloudflare Workers Builds creates and manages the build API token. Do not add `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` to GitHub for this deployment path.

Every production-branch push builds and deploys the Worker. Non-production branch builds upload a Worker version instead of promoting it, which lets Cloudflare attach preview status and URLs to pull requests.

The default build watch path can remain `*`. Narrow it only if deploys from documentation-only changes become noisy.

## R2 payloads

The R2 bucket stores:

- the pinned BiRefNet Lite ONNX model at `/models/...`
- ONNX Runtime's WebGPU asyncify WASM binary at `/runtime/ort-wasm-simd-threaded.asyncify.wasm`
- ONNX Runtime's standard WASM fallback binary at `/runtime/ort-wasm-simd-threaded.wasm`
- ONNX Runtime's module loader at `/runtime/ort-wasm-simd-threaded.mjs`

The model is about 187 MiB, the WebGPU asyncify WASM binary is about 26.8 MiB, and the standard WASM fallback binary is about 14.2 MiB. These files stay in R2 rather than Workers Static Assets.

The model and runtime objects are immutable, version-pinned deployment inputs. Ordinary site deploys do not re-upload them. Seed or replace them only when the pinned model or ONNX Runtime payload changes.

The Worker reads them through the `MODELS` R2 binding, so the Worker itself does not contain R2 credentials.

## Local Cloudflare test

Install dependencies:

```sh
bun install --frozen-lockfile
```

Seed Wrangler's local R2 storage with the model and ONNX Runtime files:

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

Check the page, model route, and runtime routes:

```sh
curl -I http://localhost:8787/
curl -I http://localhost:8787/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.asyncify.wasm
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.wasm
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.mjs
```

Both WASM routes must return `content-type: application/wasm`. The module loader must return JavaScript rather than SPA HTML. The model route must return the model object rather than SPA HTML.

Then open the local site in a Chromium browser and run normal, explicit WebGPU, and explicit WASM removal. Acceptance requires a clean console and correct output.

## Remote R2 bootstrap or payload update

This is an operator action, not part of every site deploy.

Authenticate Wrangler on an operator machine:

```sh
bunx wrangler@4.133.0 login
```

Create the bucket only if it does not already exist:

```sh
bunx wrangler@4.133.0 r2 bucket create bgcut-models
```

Prepare the exact validated model:

```sh
bun run model:prepare
```

Upload the model:

```sh
bunx wrangler@4.133.0 r2 object put \
  bgcut-models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --file public/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --content-type application/octet-stream \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote
```

Upload the pinned ONNX Runtime files:

```sh
bunx wrangler@4.133.0 r2 object put \
  bgcut-models/ort-wasm-simd-threaded.asyncify.wasm \
  --file node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm \
  --content-type application/wasm \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote

bunx wrangler@4.133.0 r2 object put \
  bgcut-models/ort-wasm-simd-threaded.wasm \
  --file node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm \
  --content-type application/wasm \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote

bunx wrangler@4.133.0 r2 object put \
  bgcut-models/ort-wasm-simd-threaded.mjs \
  --file node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs \
  --content-type text/javascript \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote
```

Verify the model:

```sh
bunx wrangler@4.133.0 r2 object get \
  bgcut-models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --remote \
  --pipe | shasum -a 256
```

Expected SHA-256:

```text
4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c
```

## Production verification

After a successful Cloudflare production build:

```sh
curl -I https://bgcut.dev/
curl -I https://bgcut.dev/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.asyncify.wasm
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.wasm
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.mjs
```

Run a real WebGPU browser removal on `https://bgcut.dev` before treating a production change as accepted.

## CI gate

`.github/workflows/cloudflare.yml` builds the Cloudflare payload and runs `wrangler deploy --dry-run` plus the local R2 runtime smoke on pull requests and pushes to `main`. It never deploys production resources.

The production deployment is owned by Cloudflare Workers Builds. The npm release workflow remains separate.
