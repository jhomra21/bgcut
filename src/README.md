# Source layout

bgcut is one published package, so the repository uses internal module boundaries instead of workspaces.

- `app/`: Solid UI. `pages/` owns page-level workflows/content, `components/` owns reusable UI/site chrome, and `App.tsx` owns routing orchestration.
- `core/`: runtime-neutral model/runtime constants, preprocessing, and matte math.
- `browser/`: browser inference runtime.
- `native/`: Node-only inference, model cache, model-file integrity, and image-output helpers.
- `cli/`: command parsing, command execution, and the packaged local server.
- `node/`: public `createBgcut()` API surface.

Dependency direction is intentional:

```text
app -> browser -> core
cli -> native -> core
node -> native -> core
```

Do not put reusable native logic in `cli/`. Keep runtime-neutral math and model constants in `core/`. Keep `node/` thin so the package API remains separate from implementation details.
