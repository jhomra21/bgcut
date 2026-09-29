import { CodeBlock } from "../components/CodeBlock";
import { ReferencePage } from "../components/ReferencePage";
import type { SectionRailGroup } from "../components/SectionRail";

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
  <ReferencePage
    title="Documentation"
    pageClass="docs-page"
    railAriaLabel="Documentation sections"
    railGroups={DOC_SECTION_GROUPS}
    initialSectionId="quickstart"
    bottomSectionId="resources"
  >

        <section id="quickstart" class="reference-section doc-section docs-quickstart">
          <h3>Quickstart</h3>
          <p>Run the local web app from npm without installing bgcut globally:</p>
          <CodeBlock language="shell" code="npx bgcut" />
          <p class="docs-related">
            For headless removal, run <a href="#cli"><code>npx bgcut photo.jpg</code></a>.
            For application code, <a href="#node-api">install bgcut and use the Node API</a>.
          </p>
          <h4>Choose an interface</h4>
          <div class="spec-table" role="table" aria-label="bgcut interfaces">
            <div class="spec-row" role="row">
              <strong role="cell">Hosted browser</strong>
              <span role="cell">Interactive removal and before/after inspection without an install.</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Local app</strong>
              <span role="cell">The browser workflow from the npm package on a loopback server.</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">CLI</strong>
              <span role="cell">File-in/file-out automation, shell scripts, and directory batches.</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Node API</strong>
              <span role="cell">Application code that reuses one native runtime across removals.</span>
            </div>
          </div>
        </section>

        <section id="web-ui" class="reference-section doc-section">
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

        <section id="local-app" class="reference-section doc-section">
          <h3>Local app</h3>
          <p>
            Run bgcut with no image to start the packaged remover on <code>127.0.0.1</code>.
            The local UI contains the bgcut brand and removal workflow only. Docs, Changelog, GitHub
            navigation, Privacy, Terms, and the site footer remain on bgcut.dev.
          </p>
          <CodeBlock
            language="shell"
            code={`npm install -g bgcut
bgcut

# explicit form
bgcut serve

# fixed port
bgcut serve --port 8787

# keep the browser closed
bgcut serve --no-open

# machine-readable startup metadata
bgcut serve --json`}
          />
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

        <section id="cli" class="reference-section doc-section">
          <h3>CLI</h3>
          <p>
            Pass one image path for the existing file-in/file-out flow. Pass several files or a
            directory for batch removal. Directory scans are recursive. Batch inference runs one
            image at a time and reuses one warm runtime.
          </p>
          <CodeBlock
            language="shell"
            code={`bgcut photo.jpg
bgcut remove photo.jpg
bgcut photo.jpg -o portrait.png

# several files or a directory
bgcut first.jpg second.png
bgcut photos/
bgcut photos/ -o ./cutouts

# output formats
bgcut photo.jpg --png
bgcut photo.jpg --webp
bgcut photo.jpg --jpg

# provider constraints
bgcut photo.jpg --gpu
bgcut photo.jpg --cpu`}
          />
          <div class="spec-table" role="table" aria-label="CLI behavior">
            <div class="spec-row" role="row">
              <strong role="cell">Inputs</strong>
              <span role="cell">JPEG, PNG, WebP, AVIF files; recursive directories</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Outputs</strong>
              <span role="cell">PNG, lossless WebP, JPG/JPEG on white</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">Automatic engine</strong>
              <span role="cell">Start the WebGPU runtime first, then use CPU if it cannot start</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">GPU-only</strong>
              <span role="cell"><code>--gpu</code> returns an error if the WebGPU runtime cannot start</span>
            </div>
          </div>
          <p>
            For a single file, <code>--output</code> names the output file. For a batch, it names
            an output directory and preserves nested paths. Without <code>--output</code>, each
            result is written next to its source image. Sharp/libvips decodes each image from its
            contents, not from the filename extension. bgcut also accepts <code>-png</code>, <code>-webp</code>, <code>-jpg</code>,
            <code>-gpu</code>, and <code>-cpu</code>.
          </p>
        </section>

        <section id="node-api" class="reference-section doc-section">
          <h3>Node API</h3>
          <p>Install <code>bgcut</code> from npm:</p>
          <CodeBlock language="shell" code="npm install bgcut" />

          <div class="spec-table" role="table" aria-label="Node API">
            <div class="spec-row" role="row">
              <strong role="cell">bgcut(options?)</strong>
              <span role="cell">Open a reusable bgcut instance. Close it when finished.</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">remover.removeBackground(input, options?)</strong>
              <span role="cell">Remove one image with the open instance.</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">remover.removeMany(inputs, options?)</strong>
              <span role="cell">Process files, directories, or iterables sequentially and stream per-image results.</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">remover.close()</strong>
              <span role="cell">Release the reusable native runtime.</span>
            </div>
          </div>

          <h4>Open bgcut</h4>
          <CodeBlock
            language="typescript"
            code={`import { bgcut } from "bgcut";

const remover = await bgcut();

try {
  // Use remover.removeBackground() or remover.removeMany().
} finally {
  await remover.close();
}`}
          />

          <h4>Migrating from 0.5.x</h4>
          <p>
            Version 0.6 removes the top-level <code>removeBackground()</code> and
            <code>createBgcut()</code> exports. Open one instance with <code>bgcut()</code>, call
            methods on that instance, and close it when finished. Choose the engine when opening
            the instance. Choose the output format per removal.
          </p>
          <p>One image in 0.5.x:</p>
          <CodeBlock
            language="typescript"
            code={`import { removeBackground } from "bgcut";

const result = await removeBackground("photo.jpg", {
  engine: "cpu",
  format: "webp",
});`}
          />
          <p>The same call in 0.6:</p>
          <CodeBlock
            language="typescript"
            code={`import { bgcut } from "bgcut";

const remover = await bgcut({ engine: "cpu" });

try {
  const result = await remover.removeBackground("photo.jpg", {
    format: "webp",
  });
} finally {
  await remover.close();
}`}
          />
          <p>Reusable work in 0.5.x:</p>
          <CodeBlock
            language="typescript"
            code={`import { createBgcut } from "bgcut";

const remover = await createBgcut();

try {
  await remover.remove("first.jpg");
  await remover.remove("second.jpg");
} finally {
  await remover.close();
}`}
          />
          <p>The same work in 0.6:</p>
          <CodeBlock
            language="typescript"
            code={`import { bgcut } from "bgcut";

const remover = await bgcut();

try {
  await remover.removeBackground("first.jpg");
  await remover.removeBackground("second.jpg");
} finally {
  await remover.close();
}`}
          />
          <p>
            For several inputs, prefer <code>removeMany()</code>. It accepts files, directories,
            iterables, and async iterables. It yields each result as it finishes and keeps later
            inputs running after an image-level failure.
          </p>

          <h4>Single image</h4>
          <p>
            Use <code>removeBackground()</code> on the bgcut instance. Choose the output format per
            image when needed.
          </p>
          <CodeBlock
            language="typescript"
            code={`const result = await remover.removeBackground("photo.jpg");

const webp = await remover.removeBackground("photo.jpg", {
  format: "webp",
});`}
          />

          <h4>Multiple images</h4>
          <p>
            Use <code>removeMany()</code> for several files, a directory, an iterable, or an async
            iterable. Results are yielded one at a time. Processing is sequential so one warm
            runtime can be reused without decoding an entire batch up front.
          </p>
          <CodeBlock
            language="typescript"
            code={`for await (const item of remover.removeMany([
  "first.jpg",
  "second.png",
])) {
  if (!item.ok) {
    console.error(item.source.input, item.error);
    continue;
  }

  console.log(item.source.input, item.result);
}`}
          />
          <p>
            Directory inputs are recursive by default. Pass <code>recursive: false</code> to
            process only the immediate image files.
          </p>
          <CodeBlock
            language="typescript"
            code={`for await (const item of remover.removeMany("photos", {
  recursive: false,
})) {
  // ...
}`}
          />

          <h4>Inputs and result</h4>
          <p>
            Single-image inputs can be a file path, <code>Uint8Array</code>, or
            <code>ArrayBuffer</code>. <code>removeMany()</code> accepts one of those inputs or an
            iterable/async iterable of them. Supported image formats are JPEG, PNG, WebP, and AVIF.
          </p>
          <CodeBlock
            language="typescript"
            code={`type BgcutRemovalResult = {
  data: Uint8Array;
  width: number;
  height: number;
  format: "png" | "webp" | "jpg";
  engine: "webgpu" | "cpu";
  fallbackReason: string | undefined;
  timings: {
    totalMs: number;
    prepareMs: number;
    inferenceMs: number;
    encodeMs: number;
  };
};`}
          />

          <h4>Engines and lifecycle</h4>
          <p>
            Choose the engine when opening bgcut. <code>{"bgcut({ engine: \"gpu\" })"}</code>
            requires native WebGPU, while <code>{"bgcut({ engine: \"cpu\" })"}</code> requires
            CPU. The default <code>auto</code> mode tries WebGPU first and falls back to CPU if
            runtime creation fails. Always call <code>close()</code> when finished.
          </p>

          <h4>Errors</h4>
          <p>
            Node API failures use one public error type. Handle <code>BgcutError.code</code>
            instead of depending on Effect or ONNX Runtime error classes.
          </p>
          <CodeBlock
            language="typescript"
            code={`import { BgcutError, bgcut } from "bgcut";

const remover = await bgcut();

try {
  await remover.removeBackground("photo.jpg");
} catch (error) {
  if (error instanceof BgcutError) {
    console.error(error.code, error.message);
  }
} finally {
  await remover.close();
}`}
          />
          <p>
            Error codes are <code>model</code>, <code>engine</code>, <code>input</code>,
            <code>inference</code>, <code>output</code>, and <code>closed</code>.
          </p>
        </section>
        <section id="model" class="reference-section doc-section">
          <h3>Model and runtime</h3>
          <p class="docs-section-summary">
            The model input is 512 x 512. bgcut restores the matte to the source image size before
            export.
          </p>
          <p>
            bgcut uses <code>studioludens/birefnet-lite-512</code> at one pinned source revision.
            The runtime has validated FP32 and internal-FP16 artifacts with the same 512 x 512
            public model input.
          </p>
          <div class="spec-table" role="table" aria-label="Model metadata">
            <div class="spec-row" role="row">
              <strong role="cell">Source revision</strong>
              <span role="cell"><code>4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7</code></span>
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

          <div class="model-artifact-table-wrap">
            <table class="model-artifact-table">
              <thead>
                <tr>
                  <th scope="col">Artifact</th>
                  <th scope="col">Runtime</th>
                  <th scope="col">Size</th>
                  <th scope="col">SHA-256</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="model-artifact-name">
                    <strong>FP32</strong>
                    <code>birefnet-lite-512-ort-basic-webgpu-v2.onnx</code>
                  </td>
                  <td>Native CLI, Node API, Chromium WebGPU, browser WebAssembly, Safari fallback</td>
                  <td class="model-artifact-size">195,872,736 bytes</td>
                  <td class="model-artifact-hash">
                    <code>4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c</code>
                  </td>
                </tr>
                <tr>
                  <td class="model-artifact-name">
                    <strong>FP16</strong>
                    <code>birefnet-lite-512-ort-basic-webgpu-v2-fp16.onnx</code>
                  </td>
                  <td>Safari WebGPU with <code>shader-f16</code></td>
                  <td class="model-artifact-size">98,572,669 bytes</td>
                  <td class="model-artifact-hash">
                    <code>37d4035765b97a0323729fdee787d16eb7238c39c467316e887c5292792f3e33</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The npm package does not include either model artifact. Native CLI and Node API runs
            use FP32. The packaged local browser app can cache both artifacts in the operating-system
            user cache. Safari WebGPU uses FP16 only when the device exposes <code>shader-f16</code>;
            Safari without that feature, Chromium-family WebGPU, and browser WebAssembly use FP32.
            bgcut verifies the byte size and SHA-256 before reusing a cached model.
          </p>
        </section>

        <section id="architecture" class="reference-section doc-section">
          <h3>Architecture</h3>
          <p class="docs-section-summary">
            Browser and native paths use a 512 x 512 model input and composite the matte at the
            source image size.
          </p>
          <div class="architecture-grid">
            <div class="architecture-card">
              <strong>Browser path</strong>
              <span>Browser decode</span>
              <span>Automatic mode tries WebGPU, then WebAssembly after supported failures</span>
              <span>Safari WebGPU uses FP16 when the device exposes shader-f16; other browser paths use FP32</span>
              <span>WebGPU input uses TypeGPU resize and ImageNet normalization</span>
              <span>WebAssembly input uses canvas resize and the same normalization</span>
              <span>Matte compositing at source size</span>
              <span>Transparent PNG export</span>
            </div>
            <div class="architecture-card">
              <strong>Native Node path</strong>
              <span>Sharp/libvips decode and orientation</span>
              <span>Linear resize and ImageNet normalization</span>
              <span>FP32 with ONNX Runtime Node WebGPU or CPU</span>
              <span>Matte compositing at source size</span>
              <span>PNG, lossless WebP, or JPG export</span>
            </div>
          </div>
          <p>
            Cloudflare Workers hosts bgcut.dev. Workers Static Assets serves the app files. Private
            R2 stores both pinned model artifacts and the ONNX Runtime browser files. The Worker
            exposes them through same-origin <code>/models/*</code> and <code>/runtime/*</code> routes.
          </p>
        </section>

        <section id="resources" class="reference-section doc-section">
          <h3>Resources</h3>
          <p class="docs-section-summary">
            Humans can use the docs and type declarations directly. Agents can start with the
            plain-text index or the packaged skill.
          </p>
          <div class="resource-grid">
            <a href="/llms.txt">
              <strong>Agent index</strong>
              <span>Concise public contract, commands, API entry points, and canonical links.</span>
              <code>/llms.txt</code>
            </a>
            <a
              href="https://github.com/jhomra21/bgcut/blob/main/skills/bgcut/SKILL.md"
              target="_blank"
              rel="noreferrer"
            >
              <strong>Agent skill</strong>
              <span>Operational guidance shipped inside the npm package.</span>
              <code>skills/bgcut/SKILL.md</code>
            </a>
            <a
              href="https://github.com/jhomra21/bgcut/blob/main/src/node/index.d.ts"
              target="_blank"
              rel="noreferrer"
            >
              <strong>Node API types</strong>
              <span>Published TypeScript declarations for the Node API.</span>
              <code>src/node/index.d.ts</code>
            </a>
          </div>
          <div class="link-list">
            <a href="https://github.com/jhomra21/bgcut" target="_blank" rel="noreferrer">GitHub repository</a>
            <a href="https://www.npmjs.com/package/bgcut" target="_blank" rel="noreferrer">npm package</a>
            <a href="/changelog">Changelog</a>
            <a href="https://github.com/jhomra21/bgcut/releases" target="_blank" rel="noreferrer">GitHub releases</a>
            <a href="https://github.com/jhomra21/bgcut/blob/main/README.md" target="_blank" rel="noreferrer">README</a>
          </div>
        </section>
  </ReferencePage>
);
