# Deploying bgcut.dev

The web app deploys to Cloudflare Workers with Static Assets. Large runtime assets live in the private R2 bucket `bgcut-models` and are served by the same Worker.

The R2 bucket currently stores:

- the pinned BiRefNet Lite ONNX model, served at `/models/...`
- ONNX Runtime's WebGPU asyncify WASM binary, served at `/runtime/ort-wasm-simd-threaded.asyncify.wasm`
- ONNX Runtime's standard WASM fallback binary, served at `/runtime/ort-wasm-simd-threaded.wasm`
- ONNX Runtime's module loader, served at `/runtime/ort-wasm-simd-threaded.mjs`

The model is about 187 MiB, the WebGPU asyncify WASM binary is about 26.8 MiB, and the standard WASM fallback binary is about 14.2 MiB. The module loader is small, but it belongs to the same runtime boundary. All four files live in R2. The Cloudflare build strips discrete ONNX Runtime runtime files from `dist/` and fails if one leaks back into Workers Static Assets.

## Architecture

```text
bgcut.dev
  -> Cloudflare Worker
     -> Vite SPA from Workers Static Assets
     -> /models/* from private R2 bucket bgcut-models
     -> /runtime/* from private R2 bucket bgcut-models
```

Source images never go through the Worker or R2. Browser image decoding, preprocessing, inference, compositing, and export still happen on the user's device.

`wrangler.jsonc` is the deployment source of truth. It configures:

- Worker name `bgcut-web`
- `bgcut.dev` as a Worker Custom Domain
- `dist/` as the SPA asset directory
- SPA navigation fallback to `index.html`
- the `MODELS` binding to the `bgcut-models` R2 bucket
- Worker-first routing for `/models/*` and `/runtime/*`

## Local Cloudflare test

Install the repo dependencies first:

```sh
bun install --frozen-lockfile
```

Seed Wrangler's local R2 storage with the model and all ONNX Runtime runtime files:

```sh
bun run cloudflare:r2:local
```

This prepares the validated model, copies it into local R2, and copies the exact ONNX Runtime 1.30.0 WebGPU asyncify binary, fallback WASM binary, and module loader from `node_modules` into local R2. It writes local Wrangler state under `.wrangler/`. It does not create or modify a remote R2 bucket.

Build the exact static payload Cloudflare would receive:

```sh
bun run build:cloudflare
```

Run Wrangler's deploy compilation without uploading anything:

```sh
bun run cloudflare:dry-run
```

Start the Worker and local R2 simulation:

```sh
bun run cloudflare:dev
```

Use the local URL printed by Wrangler, normally `http://localhost:8787`.

Check the page, model route, and WebGPU runtime route from another terminal:

```sh
curl -I http://localhost:8787/
curl -I http://localhost:8787/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.asyncify.wasm
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.wasm
curl -I http://localhost:8787/runtime/ort-wasm-simd-threaded.mjs
```

Both WASM routes must return `content-type: application/wasm`. The module loader must return JavaScript, not SPA HTML. The model route must return the full model object rather than the SPA HTML.

Then open the local site in a Chromium browser and run a normal image removal. Acceptance requires:

- no ONNX Runtime WASM MIME or compile errors in the console
- WebGPU mode completes without falling through to the WebAssembly compatibility path
- explicit `?engine=wasm` still works
- the result slider, copy, download, redo, and new-image controls still work

## One-time Cloudflare production setup

Do not run these commands until the local Cloudflare test passes.

Authenticate Wrangler:

```sh
bunx wrangler@4.133.0 login
```

Make sure `bgcut.dev` is a Cloudflare zone in the same account. If the domain uses another registrar, its authoritative nameservers must point to the Cloudflare nameservers for the zone before the Worker Custom Domain can become active.

Create the private R2 bucket once:

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

Upload the pinned ONNX Runtime files from the `onnxruntime-web@1.30.0` install:

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

Verify the remote model against the pinned SHA-256:

```sh
bunx wrangler@4.133.0 r2 object get \
  bgcut-models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --remote \
  --pipe | shasum -a 256
```

Expected model SHA-256:

```text
4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c
```

Verify that the remote WebGPU runtime is byte-identical to the pinned local package artifact:

```sh
LOCAL_RUNTIME_SHA="$(shasum -a 256 node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm | awk '{print $1}')"
REMOTE_RUNTIME_SHA="$(bunx wrangler@4.133.0 r2 object get bgcut-models/ort-wasm-simd-threaded.asyncify.wasm --remote --pipe | shasum -a 256 | awk '{print $1}')"

test "$LOCAL_RUNTIME_SHA" = "$REMOTE_RUNTIME_SHA"
printf '%s\n' "$REMOTE_RUNTIME_SHA"
```

Run the dry deployment gate again:

```sh
bun run cloudflare:dry-run
```

## Production deployment

A production deployment changes live Cloudflare resources and attaches the Worker to `bgcut.dev`.

Build and deploy only after the exact candidate is accepted:

```sh
bun run build:cloudflare
bunx wrangler@4.133.0 deploy
```

The `custom_domain` entry in `wrangler.jsonc` makes the Worker the origin for `bgcut.dev`. Cloudflare manages the Worker DNS record and certificate for the custom domain.

After deployment:

```sh
curl -I https://bgcut.dev/
curl -I https://bgcut.dev/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.asyncify.wasm
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.wasm
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.mjs
```

The WASM responses must use `application/wasm`, and the module response must use JavaScript. Run a real WebGPU browser removal on `https://bgcut.dev` before treating the deployment as accepted.

## CI gate

`.github/workflows/cloudflare.yml` builds the Cloudflare payload and runs `wrangler deploy --dry-run` on pull requests and pushes to `main`. It does not deploy production resources.

The production deploy remains separate from the npm release workflow. Do not make an npm release depend on a live website deployment unless that dependency is intentional for the release.
