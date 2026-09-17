# Deploying bgcut.dev

The web app deploys to Cloudflare Workers with Static Assets. The ONNX model is stored in a private R2 bucket and served by the same Worker at `/models/...`.

This split is required because Cloudflare limits each Workers Static Asset to 25 MiB. The model is about 187 MiB. The Cloudflare build also removes ONNX Runtime's unused asyncify WASM artifact and fails if any remaining static asset is larger than the Cloudflare limit.

## Architecture

```text
bgcut.dev
  -> Cloudflare Worker
     -> Vite SPA from Workers Static Assets
     -> /models/* from private R2 bucket bgcut-models
```

Source images never go through the Worker or R2. Browser image decoding and inference still happen on the user's device.

`wrangler.jsonc` is the deployment source of truth. It configures:

- Worker name `bgcut-web`
- `bgcut.dev` as a Worker Custom Domain
- `dist/` as the SPA asset directory
- SPA navigation fallback to `index.html`
- the `MODELS` binding to the `bgcut-models` R2 bucket
- Worker-first routing only for `/models/*`

## Local Cloudflare test

Install the repo dependencies first:

```sh
bun install --frozen-lockfile
```

Prepare the validated model and seed Wrangler's local R2 storage:

```sh
bun run cloudflare:model:local
```

This writes local Wrangler state under `.wrangler/`. It does not create or modify a remote R2 bucket.

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

Check the page and model route from another terminal:

```sh
curl -I http://localhost:8787/
curl -I http://localhost:8787/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx
```

Then open the local site in a browser, drop an image, wait for removal, drag the before/after divider, reset, and download the PNG.

## One-time Cloudflare production setup

Do not run these commands until the local Cloudflare test passes.

Authenticate Wrangler:

```sh
bunx wrangler@4.133.0 login
```

Make sure `bgcut.dev` is a Cloudflare zone in the same account. If the domain uses another registrar, its authoritative nameservers must point to the Cloudflare nameservers for the zone before the Worker Custom Domain can become active.

Create the private model bucket once:

```sh
bunx wrangler@4.133.0 r2 bucket create bgcut-models
```

Prepare the exact validated model:

```sh
bun run model:prepare
```

Upload it to remote R2:

```sh
bunx wrangler@4.133.0 r2 object put \
  bgcut-models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --file public/models/birefnet-lite-512-ort-basic-webgpu-v2.onnx \
  --content-type application/octet-stream \
  --cache-control 'public, max-age=31536000, immutable' \
  --remote
```

Verify the remote object against the pinned SHA-256 before deploying the app:

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
```

Run a real browser removal on `https://bgcut.dev` before treating the deployment as accepted.

## CI gate

`.github/workflows/cloudflare.yml` builds the Cloudflare payload and runs `wrangler deploy --dry-run` on pull requests and pushes to `main`. It does not deploy production resources.

The production deploy remains separate from the npm release workflow. Do not make an npm release depend on a live website deployment unless that dependency is intentional for the release.
