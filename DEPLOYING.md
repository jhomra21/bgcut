# Deploying bgcut.dev

The web app deploys to Cloudflare Workers with Static Assets. Runtime payloads live in the private R2 bucket `bgcut-models` and are served by the same Worker.

The R2 bucket stores:

- the pinned BiRefNet Lite ONNX model at `/models/...`
- ONNX Runtime's WebGPU asyncify WASM binary at `/runtime/ort-wasm-simd-threaded.asyncify.wasm`
- ONNX Runtime's standard WASM fallback binary at `/runtime/ort-wasm-simd-threaded.wasm`
- ONNX Runtime's module loader at `/runtime/ort-wasm-simd-threaded.mjs`

The model is about 187 MiB, the WebGPU asyncify WASM binary is about 26.8 MiB, and the standard WASM fallback binary is about 14.2 MiB. The module loader is small but belongs to the same runtime boundary. All four files live in R2. The Cloudflare build removes discrete ONNX Runtime runtime files from `dist/` and fails if one leaks back into Workers Static Assets.

## Architecture

```text
bgcut.dev
  -> Cloudflare Worker
     -> Vite SPA from Workers Static Assets
     -> /models/* from private R2 bucket bgcut-models
     -> /runtime/* from private R2 bucket bgcut-models
```

Source images never go through the Worker or R2. Browser image decoding, preprocessing, inference, compositing, and export stay on the user's device.

`wrangler.jsonc` is the deployment source of truth. It configures:

- Worker name `bgcut-web`
- `bgcut.dev` as a Worker Custom Domain
- `dist/` as the SPA asset directory
- SPA navigation fallback to `index.html`
- the `MODELS` binding to the `bgcut-models` R2 bucket
- Worker-first routing for `/models/*` and `/runtime/*`

## Local Cloudflare test

Install dependencies:

```sh
bun install --frozen-lockfile
```

Seed Wrangler's local R2 storage with the model and ONNX Runtime files:

```sh
bun run cloudflare:r2:local
```

This prepares the validated model and copies the exact ONNX Runtime 1.30.0 WebGPU asyncify binary, fallback WASM binary, and module loader into local R2. It writes local Wrangler state under `.wrangler/`. It does not create or modify a remote R2 bucket.

Build the exact static payload Cloudflare would receive:

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

## Cloudflare account setup

Production CI uses Cloudflare's documented GitHub Actions authentication variables:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Store both as GitHub secrets in the `production` environment or as repository secrets. Never commit either value.

Create the API token from Cloudflare's **Edit Cloudflare Workers** template and scope it to the account and the `bgcut.dev` zone. The token needs Workers script deployment, Workers route/custom-domain access, and R2 write access because the production workflow both uploads runtime objects and deploys the Worker.

The `bgcut.dev` zone must be active in the same Cloudflare account. If the domain uses another registrar, point its authoritative nameservers to the Cloudflare nameservers assigned to the zone before the first production deploy.

## Production deployment workflow

`.github/workflows/deploy-web.yml` is the production path.

It does not deploy on ordinary pushes to `main`. A deployment starts only when either:

1. `deploy/production.json` changes on `main`, or
2. an authorized maintainer explicitly runs the workflow and supplies an exact source SHA.

The normal automated path is the deployment manifest. Start from:

```text
deploy/production.example.json
```

Create `deploy/production.json` with the exact accepted 40-character commit SHA:

```json
{
  "source_sha": "0123456789abcdef0123456789abcdef01234567"
}
```

The workflow verifies that the SHA exists and is an ancestor of the trigger commit, then checks out that exact accepted source. The manifest commit itself is not silently substituted for the accepted application source.

Before touching production, the workflow:

1. installs the exact dependencies with Bun 1.4.2;
2. runs `bun run check`;
3. runs the Cloudflare dry-run gate;
4. creates `bgcut-models` only if it does not already exist;
5. prepares and validates the pinned model;
6. uploads the model and all three ONNX Runtime files to remote R2;
7. reads the R2 objects back and checks their SHA-256 values;
8. builds the Cloudflare payload;
9. runs `wrangler deploy`;
10. waits for `bgcut.dev` and verifies the model and runtime routes.

The deployment workflow records the exact deployed source SHA in the GitHub Actions job summary.

## Manual production commands

The GitHub workflow is the normal production path. These commands are useful only for recovery or direct operator work from an authenticated machine.

Authenticate Wrangler:

```sh
bunx wrangler@4.133.0 login
```

Create the bucket if it does not exist:

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

Run the final gate and deploy:

```sh
bun run cloudflare:dry-run
bun run build:cloudflare
bunx wrangler@4.133.0 deploy
```

After deployment:

```sh
curl -I https://bgcut.dev/
curl -I https://bgcut.dev/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.asyncify.wasm
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.wasm
curl -I https://bgcut.dev/runtime/ort-wasm-simd-threaded.mjs
```

Run a real WebGPU browser removal on `https://bgcut.dev` before treating the production deployment as accepted.

## CI gate

`.github/workflows/cloudflare.yml` builds the Cloudflare payload and runs `wrangler deploy --dry-run` plus the local R2 runtime smoke on pull requests and pushes to `main`. It does not deploy production resources.

The production deploy remains separate from the npm release workflow.
