# Source layout

bgcut is one published package, so the repository uses internal module boundaries instead of workspaces.

- `app/`: Solid UI and site shells.
- `engine/`: browser inference runtime.
- `native/`: Node-only inference, model cache, model-file integrity, and image-output helpers.
- `cli/`: command parsing, command execution, and the packaged local server.
- `node/`: public `createBgcut()` API surface.

Dependency direction is intentional:

```text
app -> engine
cli -> native
node -> native
native -> engine pure image/model helpers
```

Do not put reusable native logic in `cli/`. Keep `node/` thin so the package API remains separate from implementation details.
