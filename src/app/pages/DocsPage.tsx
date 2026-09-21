import { SectionRail, type SectionRailGroup } from "../components/SectionRail";

const DOC_SECTION_GROUPS: readonly SectionRailGroup[] = [
  {
    label: "Start",
    items: [
      { id: "quickstart", label: "Quickstart" },
    ],
  },
  {
    label: "Use",
    items: [
      { id: "web-ui", label: "Web UI" },
      { id: "local-app", label: "Local app" },
      { id: "cli", label: "CLI" },
      { id: "node-api", label: "Node API" },
    ],
  },
  {
    label: "Reference",
    items: [
      { id: "model", label: "Model & runtime" },
      { id: "architecture", label: "Architecture" },
      { id: "resources", label: "Resources" },
    ],
  },
];

export const DocsPage = () => (
  <main class="page-content content-shell">
    <div class="content-layout">
      <SectionRail
        ariaLabel="Documentation sections"
        groups={DOC_SECTION_GROUPS}
        initialSectionId="quickstart"
        sectionSelector=".docs-page > section[id]"
        bottomSectionId="resources"
      />

      <article class="content-page docs-page">
        <header class="docs-page-header">
          <h1>Documentation</h1>
        </header>

        <section id="quickstart" class="doc-section docs-quickstart">
          <h3>Quickstart</h3>
          <p>Run the local web app from npm without installing bgcut globally:</p>
          <pre class="code-block"><code>npx bgcut</code></pre>
          <p class="docs-related">
            For headless removal, run <a href="#cli"><code>npx bgcut photo.jpg</code></a>.
            For application code, <a href="#node-api">install bgcut and use the Node API</a>.
          </p>
        </section>

        <section id="web-ui" class="doc-section">
          <h3>Web UI</h3>
          <p>
            Choose, drag, or paste an image. bgcut removes the background in the browser. Use the
            comparison slider to inspect the result, then copy or download the PNG, rerun the
            removal, or choose another image. The browser accepts JPEG, PNG, WebP, and AVIF.
          </p>
          <div class="shortcut-list" aria-label="Keyboard shortcuts">
            <div><kbd>⌘/Ctrl+O</kbd><span>Choose image</span></div>
            <div><kbd>⌘/Ctrl+V</kbd><span>Paste image</span></div>
            <div><kbd>N</kbd><span>New image</span></div>
            <div><kbd>C</kbd><span>Copy PNG</span></div>
            <div><kbd>D</kbd><span>Download PNG</span></div>
            <div><kbd>R</kbd><span>Redo removal</span></div>
            <div><kbd>←</kbd><kbd>→</kbd><span>Move focused comparison slider</span></div>
          </div>
          <p>
            Automatic browser mode tries ONNX Runtime WebGPU first. If WebGPU is unavailable or
            its setup or inference fails, bgcut retries with ONNX Runtime WebAssembly. Both paths
            run inference on the user's device.
          </p>
        </section>

        <section id="local-app" class="doc-section">
          <h3>Local app</h3>
          <p>
            Run bgcut with no image to start the packaged remover on <code>127.0.0.1</code>.
            The local UI contains the bgcut brand and removal workflow only. Docs, Changelog, GitHub
            navigation, Privacy, Terms, and the site footer remain on bgcut.dev.
          </p>
          <pre class="code-block"><code>{`npm install -g bgcut
bgcut

# explicit form
bgcut serve

# fixed port
bgcut serve --port 8787

# keep the browser closed
bgcut serve --no-open

# machine-readable startup metadata
bgcut serve --json`}</code></pre>
          <p>
            <code>serve --json</code> does not open a browser. It prints one JSON object with
            <code>url</code>, <code>host</code>, <code>port</code>, and <code>pid</code>.
            If <code>--port</code> is omitted, the operating system chooses an available port.
            Non-root app routes redirect to <code>/</code>. The server exposes
            <code>/health</code>, the validated model under <code>/models/...</code>, and the
            installed ONNX Runtime browser files under <code>/runtime/...</code>. Image inference
            still runs in the browser.
          </p>
        </section>

        <section id="cli" class="doc-section">
          <h3>CLI</h3>
          <p>
            Pass one image path to run headless removal. By default, bgcut writes
            <code>&lt;name&gt;-nobg.png</code> next to the input image. The explicit
            <code>remove</code> command does the same thing.
          </p>
          <pre class="code-block"><code>{`bgcut photo.jpg
bgcut remove photo.jpg
bgcut photo.jpg -o portrait.png

# output formats
bgcut photo.jpg --png
bgcut photo.jpg --webp
bgcut photo.jpg --jpg

# provider constraints
bgcut photo.jpg --gpu
bgcut photo.jpg --cpu`}</code></pre>
          <div class="spec-table" role="table" aria-label="CLI behavior">
            <div class="spec-row" role="row">
              <strong role="cell">Inputs</strong>
              <span role="cell">JPEG, PNG, WebP, AVIF</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Outputs</strong>
              <span role="cell">PNG, lossless WebP, JPG/JPEG on white</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Automatic engine</strong>
              <span role="cell">Create a WebGPU session first, then use CPU if session creation fails</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">GPU-only</strong>
              <span role="cell"><code>--gpu</code> returns an error if the WebGPU session cannot start</span>
            </div>
          </div>
          <p>
            Sharp/libvips decodes the image from its contents, not from the filename extension.
            bgcut also accepts <code>-png</code>, <code>-webp</code>, <code>-jpg</code>,
            <code>-gpu</code>, and <code>-cpu</code>.
          </p>
        </section>

        <section id="node-api" class="doc-section">
          <h3>Node API</h3>
          <p>
            During 0.4 beta validation, install <code>bgcut@beta</code>. Stable installs remain on
            <code>bgcut@latest</code> until the beta is accepted. For one image, use
            <code>removeBackground()</code>. It owns setup and cleanup for the call and returns
            only the image result fields most callers need.
          </p>
          <pre class="code-block"><code>{`import { writeFile } from "node:fs/promises";
import { removeBackground } from "bgcut";

const result = await removeBackground("photo.jpg");
await writeFile("photo-nobg.png", result.data);`}</code></pre>

          <h4>One-shot options and result</h4>
          <p>
            Pass <code>format</code> or <code>engine</code> only when you need to override the
            defaults. Inputs can be a file path, <code>Uint8Array</code>, or
            <code>ArrayBuffer</code>. Output formats are <code>png</code>, <code>webp</code>, and
            <code>jpg</code>.
          </p>
          <pre class="code-block"><code>{`const result = await removeBackground("photo.jpg", {
  format: "webp",
  engine: "cpu",
});

type RemoveBackgroundResult = {
  data: Uint8Array;
  width: number;
  height: number;
  format: "png" | "webp" | "jpg";
};`}</code></pre>

          <h4>Reusable session</h4>
          <p>
            When processing several images, create one bgcut instance so the ONNX Runtime session
            stays warm across removals.
          </p>
          <pre class="code-block"><code>{`import { createBgcut } from "bgcut";

const bgcut = await createBgcut();

try {
  const first = await bgcut.remove("first.jpg");
  const second = await bgcut.remove("second.jpg", { format: "webp" });
} finally {
  await bgcut.close();
}`}</code></pre>
          <p>
            <code>createBgcut()</code> defaults to automatic engine selection. Use
            <code>engine: "gpu"</code> to require native WebGPU or <code>engine: "cpu"</code> to
            require CPU. The reusable instance also exposes the selected engine, fallback reason,
            setup timings, and per-removal timings for callers that need runtime diagnostics.
          </p>

          <h4>Errors</h4>
          <p>
            Node API failures use one public error type. Handle <code>BgcutError.code</code>
            instead of depending on Effect or ONNX Runtime error classes.
          </p>
          <pre class="code-block"><code>{`import { BgcutError, removeBackground } from "bgcut";

try {
  await removeBackground("photo.jpg");
} catch (error) {
  if (error instanceof BgcutError) {
    console.error(error.code, error.message);
  }
}`}</code></pre>
          <p>
            Error codes are <code>model</code>, <code>engine</code>, <code>input</code>,
            <code>inference</code>, <code>output</code>, and <code>closed</code>.
          </p>
        </section>

        <section id="model" class="doc-section">
          <h3>Model and runtime</h3>
          <p class="docs-section-summary">
            The model input is 512 x 512. bgcut restores the matte to the source image size before
            export.
          </p>
          <p>
            bgcut uses <code>studioludens/birefnet-lite-512</code> at one pinned source revision
            and one verified ONNX artifact.
          </p>
          <div class="spec-table" role="table" aria-label="Model metadata">
            <div class="spec-row" role="row">
              <strong role="cell">Revision</strong>
              <span role="cell"><code>4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7</code></span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Artifact</strong>
              <span role="cell"><code>birefnet-lite-512-ort-basic-webgpu-v2.onnx</code></span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Artifact size</strong>
              <span role="cell">195,872,736 bytes</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">SHA-256</strong>
              <span role="cell" class="breakable"><code>4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c</code></span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Inference size</strong>
              <span role="cell">512 x 512</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Export size</strong>
              <span role="cell">Original source dimensions</span>
            </div>
          </div>
          <p>
            The npm package does not include the 195,872,736-byte model. The CLI, local app, and
            Node API download the pinned artifact from the bgcut GitHub release when needed, verify
            its byte size and SHA-256, and reuse the operating-system user cache.
          </p>
        </section>

        <section id="architecture" class="doc-section">
          <h3>Architecture</h3>
          <p class="docs-section-summary">
            Both runtime paths use the same 512 x 512 model and composite the matte at the source
            image size.
          </p>
          <div class="architecture-grid">
            <div class="architecture-card">
              <strong>Browser path</strong>
              <span>Browser decode</span>
              <span>Automatic mode tries WebGPU, then WebAssembly after supported failures</span>
              <span>WebGPU input uses TypeGPU resize and ImageNet normalization</span>
              <span>WebAssembly input uses canvas resize and the same normalization</span>
              <span>Matte compositing at source size</span>
              <span>Transparent PNG export</span>
            </div>
            <div class="architecture-card">
              <strong>Native Node path</strong>
              <span>Sharp/libvips decode and orientation</span>
              <span>Linear resize and ImageNet normalization</span>
              <span>ONNX Runtime Node WebGPU or CPU</span>
              <span>Matte compositing at source size</span>
              <span>PNG, lossless WebP, or JPG export</span>
            </div>
          </div>
          <p>
            Cloudflare Workers hosts bgcut.dev. Workers Static Assets serves the app files. Private
            R2 stores the pinned model and ONNX Runtime browser files, and the Worker exposes them
            through same-origin <code>/models/*</code> and <code>/runtime/*</code> routes.
          </p>
        </section>

        <section id="resources" class="doc-section">
          <h3>Resources</h3>
          <div class="link-list">
            <a href="https://github.com/jhomra21/bgcut" target="_blank" rel="noreferrer">GitHub repository</a>
            <a href="https://www.npmjs.com/package/bgcut" target="_blank" rel="noreferrer">npm package</a>
            <a href="/changelog">Changelog</a>
            <a href="https://github.com/jhomra21/bgcut/releases" target="_blank" rel="noreferrer">GitHub releases</a>
            <a href="https://github.com/jhomra21/bgcut/blob/main/README.md" target="_blank" rel="noreferrer">README</a>
          </div>
        </section>
      </article>
    </div>
  </main>
);
