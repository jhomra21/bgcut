# SEO social drafts

Use these only after the linked route is live on bgcut.dev. Edit the opening line when a release changes the context.

## Private background remover

bgcut removes image backgrounds in your browser without sending the source image to a bgcut inference server.

WebGPU when available, WebAssembly fallback when needed. No account required.

https://bgcut.dev/private-background-remover

## Node.js background removal

bgcut has a local Node.js API now:

```ts
const remover = await bgcut()
const result = await remover.removeBackground("photo.jpg")
await remover.close()
```

Reuse the same runtime for batches with `removeMany()`.

https://bgcut.dev/node-background-removal

## CLI and folders

For background removal from the terminal:

```sh
npx bgcut photo.jpg
npx bgcut photos/ -o ./cutouts
```

Files and recursive directories run locally through one warm runtime.

https://bgcut.dev/background-removal-cli

## Transparency checker

I added a small free tool to bgcut: an image transparency checker.

Drop in a PNG, WebP, JPEG, or AVIF and it reports fully transparent, partially transparent, and opaque pixels. The image stays in the browser.

https://bgcut.dev/tools/transparency-checker

## remove.bg alternative

If your remove.bg workflow is moving this year, there are two different questions:

- Do you still want a hosted service?
- Or can the machine doing the work run inference locally?

I wrote out where bgcut fits and where it does not.

https://bgcut.dev/remove-bg-alternative

## remove.bg API migration

bgcut is not a drop-in hosted replacement for the remove.bg API.

It is a local Node.js and CLI option for teams willing to move inference into their own process or machine.

That tradeoff is the point of this comparison:

https://bgcut.dev/remove-bg-api-alternative

## Guides

I published the first bgcut background-removal guides:

- no-upload browser processing
- WebGPU vs WebAssembly
- Node.js
- CLI batches
- local inference pipeline
- PNG vs WebP vs JPEG transparency
- privacy checks
- browser vs CLI vs Node.js

https://bgcut.dev/guides
