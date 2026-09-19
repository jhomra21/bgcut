# Repository guide

bgcut is intentionally a single package. The repository borrows the boundary clarity of larger reference codebases such as OpenCode v2 and Pi without copying their monorepo scale.

## Source

| Path | Owns |
| --- | --- |
| `src/app/` | Solid UI, hosted-site pages, local-app shell, UI components, and UI/site tests |
| `src/engine/` | Inference, model loading, WebGPU/WebAssembly runtime behavior, preprocessing, matte work, and shared image/model primitives |
| `src/cli/` | CLI argument parsing, headless removal command, model cache, and loopback local server |
| `src/node/` | Public `createBgcut()` API and native ONNX Runtime session |
| `src/shared/` | Utilities intentionally shared across runtimes |
| `src/worker/` | Cloudflare Worker routes for model/runtime delivery |

`src/engine/` is not labeled browser-only because the native runtime currently reuses several of its primitives. If those responsibilities are split later, do it as an architectural change with parity tests rather than as a folder rename.

## Repository tooling

| Path | Owns |
| --- | --- |
| `scripts/build/` | Build, model preparation, npm packaging, and asset preparation |
| `scripts/cloudflare/` | Cloudflare runtime upload and route smoke checks |
| `scripts/test/` | Packed-consumer and repository-level smoke tests |
| `scripts/shared/` | Helpers shared only by repository scripts |
| `tools/` | Vendored development tooling such as anti-slop |
| `skills/` | Files intentionally shipped with the npm package |

## Documentation

| Path | Contents |
| --- | --- |
| `docs/engineering/` | Benchmarks, graph-capture history, and future engineering work |
| `docs/operations/` | Deployment and release runbooks |
| `docs/images/` | README and documentation images |

The root keeps only project entry points and repository-wide policy: README, changelog, license, AGENTS, package metadata, and build/deployment configuration.

## Boundary rules

1. UI code may call the engine; the engine must not depend on Solid UI code.
2. The public Node API must remain usable without the browser app.
3. The CLI/local server may compose native and packaged-web behavior but should not own inference algorithms.
4. The Worker serves app/model/runtime bytes and never receives source images or performs inference.
5. Shared code should be moved into `src/shared/` only when more than one runtime intentionally owns the contract.
6. Add a workspace/package boundary only when there is a real second package lifecycle, not for visual organization.
