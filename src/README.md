# Source layout

bgcut is one published package. These folders are internal runtime boundaries, not independent packages.

- `app/`: Solid UI, hosted-site routing, and the packaged local-app shell.
- `browser/`: browser-only WebGPU and WebAssembly inference, image decode, compositing, and runtime state.
- `core/`: environment-neutral model metadata, runtime asset names, preprocessing, and matte math.
- `native/`: Node-only model caching, image processing, and ONNX Runtime inference shared by CLI and Node API.
- `node/`: thin public Node API entry and public types.
- `cli/`: command parsing, terminal/file output, and the loopback local-app server.

Keep dependencies moving inward:

```text
app -> browser -> core
cli -> native -> core
node -> native -> core
```

Do not put reusable native behavior in `cli/`. Do not import browser-only code from `native/`, `node/`, or `cli/`. Keep `node/` thin so the public package API stays separate from implementation details.

The repository-wide contract in `../test/repository-layout.test.ts` enforces these source-layer rules.
