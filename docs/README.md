# Repository map

bgcut is one published npm package with several runtime boundaries. The repository does not use workspaces because these parts are not independently versioned packages.

## Product code

- `src/app/`: Solid UI, hosted-site routing, local-app shell, styles, and UI components.
- `src/browser/`: browser-only background-removal runtime, including WebGPU, WebAssembly fallback, image decode, compositing, and timing.
- `src/core/`: environment-neutral model metadata, runtime asset names, matte conversion, and preprocessing core by browser and native runtimes.
- `src/native/`: Node-only implementation core by the CLI and public Node API, including model caching and native inference.
- `src/node/`: public `bgcut` Node API entry and type declarations.
- `src/cli/`: command parsing, CLI output, file writing, and the loopback local-app server.
- `worker/`: Cloudflare Worker entry for hosted static assets, model delivery, and ONNX Runtime asset delivery.

## Repository tooling

- `scripts/build/`: brand, web, Cloudflare, and npm package build preparation.
- `scripts/model/`: pinned model preparation and verification.
- `scripts/cloudflare/`: Cloudflare runtime smoke and R2 upload tooling.
- `scripts/test/`: packed-consumer acceptance tooling.
- `test/`: repository-wide policy, deployment, and architecture tests.
- `tools/`: vendored development tooling that is not product runtime code.

## Documentation

- `docs/operations/`: deployment and release procedures.
- `docs/performance/`: measured benchmarks and graph-capture notes.
- `docs/roadmap/`: future work that is outside the current product contract.
- `docs/images/`: repository and README images.

## Dependency direction

Keep runtime dependencies moving inward:

```text
app -> browser -> core
cli -> native -> core
node -> native -> core
```

The Cloudflare Worker is a separate deployment entry. Repository scripts may consume product contracts for build and verification work, but product runtime code must not depend on `scripts/` or `test/`.

`test/repository-layout.test.ts` enforces the source-layer import rules.
