# Repository layout

bgcut is one published npm package with several runtime boundaries. The repository uses directories to make those boundaries explicit without adding workspace or monorepo machinery.

## Source

```text
src/
  app/       Solid UI, hosted site, packaged local-app shell, and UI tests
  engine/    browser image pipeline and ONNX Runtime WebGPU/WebAssembly integration
  cli/       CLI commands, native orchestration, model cache, and loopback server
  node/      reusable Node API and native session/removal orchestration
  native/    Node-only implementation shared by CLI and Node API
  shared/    helpers shared across runtime boundaries
```

The dependency direction should stay simple:

- `app` may use `engine`.
- `cli` may use `node`, `native`, `shared`, and model/runtime metadata from `engine` when that metadata is genuinely shared.
- `node` may use `native` and low-level image/model helpers, but it must not depend on `cli` or the Solid app.
- `native` may be shared by `cli` and `node`, but it must not depend on either public surface.
- `shared` must not depend on UI or command surfaces.
- Browser UI code must not own native Node process behavior.

## Repository root

The root contains files that define or operate the repository itself:

- `README.md`, `CHANGELOG.md`, `LICENSE`, and `AGENTS.md`
- `package.json`, Bun/TypeScript/Vite configuration, and `wrangler.jsonc`
- `.github/` for CI, deployment, and release workflows
- `scripts/` for build, packaging, model, and deployment automation
- `worker/` for the Cloudflare Worker entrypoint
- `skills/` for the agent skill shipped in the npm package
- `tools/` for vendored development tooling
- `tests/` for repository-wide policy tests
- `docs/` for engineering and operations documentation

## Why this is not a workspace monorepo

OpenCode v2 and Pi use package workspaces because they ship and develop multiple independently meaningful packages and applications. bgcut currently publishes one package. Adding `packages/*` now would create package manifests, workspace dependency edges, and build orchestration without creating a real product boundary.

If bgcut later gains a second independently versioned package with a concrete consumer, revisit that decision. Until then, prefer explicit source directories over synthetic packages.

## Naming

Use names that describe concrete ownership. Prefer `app`, `engine`, `cli`, `node`, and `shared` over generic buckets such as `core`, `common`, `utils`, or `misc`.

Add a new top-level source directory only when it represents a durable runtime or product boundary.
