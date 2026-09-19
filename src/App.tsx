import { Effect } from "effect";
import { Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";

import ComparisonSlider from "./components/ComparisonSlider";
import { formatBackgroundRemovalError, formatImageError } from "./engine/errors";
import { removeBackground } from "./engine/inference";
import { decodeImage } from "./engine/image";

type ReadyImage = {
  readonly status: "ready";
  readonly width: number;
  readonly height: number;
  readonly name: string;
  readonly url: string;
};

type ImageState =
  | { readonly status: "empty" }
  | ReadyImage
  | { readonly status: "error"; readonly message: string };

type ReadyResult = {
  readonly status: "ready";
  readonly blob: Blob;
  readonly url: string;
  readonly downloadName: string;
};

type ResultState =
  | { readonly status: "idle" }
  | { readonly status: "processing" }
  | ReadyResult
  | { readonly status: "error"; readonly message: string };

type SitePage = "home" | "docs" | "privacy" | "terms";

type Navigate = (page: SitePage) => void;

const transparentName = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf(".");
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;

  return `${baseName || "image"}-transparent.png`;
};

const currentPage = (): SitePage => {
  const pathname = window.location.pathname.replace(/\/+$/u, "") || "/";

  if (pathname === "/docs") {
    return "docs";
  }

  if (pathname === "/privacy") {
    return "privacy";
  }

  if (pathname === "/terms") {
    return "terms";
  }

  return "home";
};

const pathForPage = (page: SitePage): string => {
  if (page === "docs") {
    return "/docs";
  }

  if (page === "privacy") {
    return "/privacy";
  }

  if (page === "terms") {
    return "/terms";
  }

  return "/";
};

const shouldHandleInternalNavigation = (event: MouseEvent): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

const SiteHeader = (props: { readonly page: SitePage; readonly onNavigate: Navigate }) => (
  <header class="app-header">
    <a
      class="brand-link"
      href="/"
      aria-label="bgcut home"
      onClick={(event) => {
        if (!shouldHandleInternalNavigation(event)) {
          return;
        }

        event.preventDefault();
        props.onNavigate("home");
      }}
    >
      <h1 class="brand-title">
        <img
          class="brand-mark"
          src="/favicon-48x48.png?v=2"
          alt=""
          width="32"
          height="32"
          aria-hidden="true"
        />
        <span>bgcut</span>
      </h1>
    </a>

    <nav class="site-nav" aria-label="Main navigation">
      <a
        href="/docs"
        aria-current={props.page === "docs" ? "page" : undefined}
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("docs");
        }}
      >
        Docs
      </a>
      <a href="https://github.com/jhomra21/bgcut" target="_blank" rel="noreferrer">
        GitHub
      </a>
    </nav>
  </header>
);

const SiteFooter = (props: { readonly onNavigate: Navigate }) => (
  <footer class="site-footer">
    <div class="site-footer-meta">
      <span>bgcut</span>
      <span>MIT licensed</span>
    </div>
    <nav class="site-footer-links" aria-label="Footer navigation">
      <a
        href="/privacy"
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("privacy");
        }}
      >
        Privacy
      </a>
      <a
        href="/terms"
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("terms");
        }}
      >
        Terms
      </a>
    </nav>
  </footer>
);

const HomePage = () => {
  const [imageState, setImageState] = createSignal<ImageState>({ status: "empty" });
  const [resultState, setResultState] = createSignal<ResultState>({ status: "idle" });
  const [copyState, setCopyState] = createSignal<"idle" | "copied" | "error">("idle");
  let fileInput: HTMLInputElement | undefined;
  let downloadLink: HTMLAnchorElement | undefined;
  let activeSourceFile: File | undefined;
  let activeSourceUrl: string | undefined;
  let activeResultUrl: string | undefined;
  let selectionVersion = 0;

  const readyImage = (): ReadyImage | undefined => {
    const state = imageState();

    return state.status === "ready" ? state : undefined;
  };

  const imageError = (): string | undefined => {
    const state = imageState();

    return state.status === "error" ? state.message : undefined;
  };

  const readyResult = (): ReadyResult | undefined => {
    const state = resultState();

    return state.status === "ready" ? state : undefined;
  };

  const resultError = (): string | undefined => {
    const state = resultState();

    return state.status === "error" ? state.message : undefined;
  };

  const processing = (): boolean => resultState().status === "processing";

  const clearResult = () => {
    if (activeResultUrl !== undefined) {
      URL.revokeObjectURL(activeResultUrl);
      activeResultUrl = undefined;
    }

    setResultState({ status: "idle" });
    setCopyState("idle");
  };

  const reset = () => {
    selectionVersion += 1;
    clearResult();

    if (activeSourceUrl !== undefined) {
      URL.revokeObjectURL(activeSourceUrl);
      activeSourceUrl = undefined;
    }

    activeSourceFile = undefined;
    setImageState({ status: "empty" });

    if (fileInput !== undefined) {
      fileInput.value = "";
    }
  };

  const runRemoval = (file: File, version: number) => {
    setResultState({ status: "processing" });

    void Effect.runPromise(
      removeBackground(file).pipe(
        Effect.match({
          onFailure: (error) => {
            if (version === selectionVersion) {
              setResultState({ status: "error", message: formatBackgroundRemovalError(error) });
            }
          },
          onSuccess: (result) => {
            if (version !== selectionVersion) {
              return;
            }

            activeResultUrl = URL.createObjectURL(result.blob);
            setResultState({
              status: "ready",
              blob: result.blob,
              url: activeResultUrl,
              downloadName: transparentName(file.name),
            });
          },
        }),
      ),
    );
  };

  const selectImage = (file: File) => {
    if (processing()) {
      return;
    }

    selectionVersion += 1;
    const version = selectionVersion;
    clearResult();
    setImageState({ status: "empty" });

    if (activeSourceUrl !== undefined) {
      URL.revokeObjectURL(activeSourceUrl);
      activeSourceUrl = undefined;
    }

    activeSourceFile = undefined;

    void Effect.runPromise(
      decodeImage(file).pipe(
        Effect.match({
          onFailure: (error) => {
            if (version === selectionVersion) {
              setImageState({ status: "error", message: formatImageError(error) });
            }
          },
          onSuccess: (dimensions) => {
            if (version !== selectionVersion) {
              return;
            }

            activeSourceUrl = URL.createObjectURL(file);
            activeSourceFile = file;
            setImageState({
              status: "ready",
              width: dimensions.width,
              height: dimensions.height,
              name: file.name,
              url: activeSourceUrl,
            });
            runRemoval(file, version);
          },
        }),
      ),
    );
  };

  const copyResult = (result: ReadyResult) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      setCopyState("error");

      return;
    }

    void navigator.clipboard
      .write([new ClipboardItem({ "image/png": result.blob })])
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("error"));
  };

  const copyLabel = (): string => {
    const state = copyState();

    if (state === "copied") {
      return "Copied";
    }

    if (state === "error") {
      return "Copy failed";
    }

    return "Copy";
  };

  const redo = () => {
    if (activeSourceFile === undefined || processing()) {
      return;
    }

    clearResult();
    runRemoval(activeSourceFile, selectionVersion);
  };

  const chooseNewImage = () => {
    reset();
    fileInput?.click();
  };

  const handleSurfaceClick = (event: MouseEvent) => {
    if (readyImage() !== undefined || event.target !== event.currentTarget) {
      return;
    }

    fileInput?.click();
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();

    if (processing()) {
      return;
    }

    const file = event.dataTransfer?.files.item(0);

    if (file !== null && file !== undefined) {
      selectImage(file);
    }
  };

  const handleFileInput = (event: Event) => {
    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.item(0);

    if (file !== null && file !== undefined) {
      selectImage(file);
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (processing()) {
      return;
    }

    const clipboardItems = event.clipboardData?.items;

    if (clipboardItems === undefined) {
      return;
    }

    for (const item of Array.from(clipboardItems)) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) {
        continue;
      }

      const file = item.getAsFile();

      if (file !== null) {
        event.preventDefault();
        selectImage(file);

        return;
      }
    }
  };

  const handleKeyboardShortcut = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();

    if ((event.metaKey || event.ctrlKey) && key === "o" && !processing()) {
      event.preventDefault();
      chooseNewImage();

      return;
    }

    if (event.metaKey || event.ctrlKey) {
      return;
    }

    const target = event.target;

    if (
      target instanceof HTMLElement &&
      (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
    ) {
      return;
    }

    if (key === "n" && !processing()) {
      event.preventDefault();
      chooseNewImage();

      return;
    }

    const result = readyResult();

    if (result === undefined) {
      return;
    }

    if (key === "c") {
      event.preventDefault();
      copyResult(result);

      return;
    }

    if (key === "d") {
      event.preventDefault();
      downloadLink?.click();

      return;
    }

    if (key === "r" && !processing()) {
      event.preventDefault();
      redo();
    }
  };

  onSettled(() => {
    window.addEventListener("keydown", handleKeyboardShortcut);
    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("keydown", handleKeyboardShortcut);
      window.removeEventListener("paste", handlePaste);
      selectionVersion += 1;

      if (activeSourceUrl !== undefined) {
        URL.revokeObjectURL(activeSourceUrl);
      }

      if (activeResultUrl !== undefined) {
        URL.revokeObjectURL(activeResultUrl);
      }

      activeSourceFile = undefined;
    };
  });

  return (
    <main class="page-content home-shell">
      <section
        class={`drop-surface${readyImage() !== undefined ? " has-image" : ""}`}
        onClick={handleSurfaceClick}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          ref={(element) => {
            fileInput = element;
          }}
          id="source-file-input"
          class="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          aria-label="Choose image"
          onChange={handleFileInput}
        />

        <Show
          keyed
          when={readyImage()}
          fallback={
            <button class="drop-trigger" type="button" onClick={() => fileInput?.click()}>
              <span class="drop-trigger-copy">
                <span class="drop-trigger-shortcuts" aria-label="Image input shortcuts">
                  <span aria-keyshortcuts="Meta+O Control+O">
                    <kbd class="shortcut-key input-shortcut-key" aria-label="Choose image shortcut, Command O">⌘O</kbd>
                  </span>
                </span>
                <strong>Click or drag image here</strong>
                <span class="drop-trigger-shortcuts" aria-label="Image input shortcuts">
                  <span aria-keyshortcuts="Meta+V Control+V">
                    or paste <kbd class="shortcut-key input-shortcut-key" aria-label="Paste image shortcut, Command V">⌘V</kbd>
                  </span>
                  <span class="drop-trigger-format">JPEG, PNG, WebP, or AVIF</span>
                </span>
              </span>
            </button>
          }
        >
          {(image) => (
            <div class="result-flow">
              <Show
                keyed
                when={readyResult()}
                fallback={
                  <div
                    class="image-stage"
                    style={`--image-aspect-ratio: ${image.width} / ${image.height};`}
                  >
                    <img class="preview-image" src={image.url} alt={image.name} />
                    <Show when={processing()}>
                      <div class="processing-label" role="status">Removing background...</div>
                    </Show>
                  </div>
                }
              >
                {(result) => (
                  <ComparisonSlider
                    leftSrc={image.url}
                    rightSrc={result.url}
                    leftAlt={`Original ${image.name}`}
                    rightAlt={`${image.name} with background removed`}
                    aspectRatio={`${image.width} / ${image.height}`}
                  />
                )}
              </Show>

              <Show keyed when={resultError()}>
                {(message) => <div class="error-card">{message}</div>}
              </Show>

              <div class="result-actions">
                <button
                  class="text-button"
                  type="button"
                  disabled={processing()}
                  aria-keyshortcuts="N"
                  title="New image (N)"
                  onClick={chooseNewImage}
                >
                  <span>New Image</span>
                  <kbd class="shortcut-key" aria-hidden="true">N</kbd>
                </button>
                <Show keyed when={readyResult()}>
                  {(result) => (
                    <div class="result-action-group">
                      <button
                        class="text-button"
                        type="button"
                        aria-keyshortcuts="C"
                        title="Copy result (C)"
                        onClick={() => copyResult(result)}
                      >
                        <span>{copyLabel()}</span>
                        <kbd class="shortcut-key" aria-hidden="true">C</kbd>
                      </button>
                      <a
                        ref={(element) => {
                          downloadLink = element;
                        }}
                        class="download-button"
                        href={result.url}
                        download={result.downloadName}
                        aria-keyshortcuts="D"
                        title="Download result (D)"
                      >
                        <span>Download</span>
                        <kbd class="shortcut-key shortcut-key-inverted" aria-hidden="true">D</kbd>
                      </a>
                      <button
                        class="text-button"
                        type="button"
                        aria-keyshortcuts="R"
                        title="Redo removal (R)"
                        onClick={redo}
                      >
                        <span>Redo</span>
                        <kbd class="shortcut-key" aria-hidden="true">R</kbd>
                      </button>
                    </div>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>

        <Show keyed when={imageError()}>
          {(message) => (
            <div class="empty-error">
              <div class="error-card">{message}</div>
              <button class="text-button" type="button" onClick={() => fileInput?.click()}>
                Choose another image
              </button>
            </div>
          )}
        </Show>
      </section>
    </main>
  );
};

const DocsPage = (props: { readonly onNavigate: Navigate }) => (
  <main class="page-content content-shell">
    <div class="content-layout">
      <aside class="docs-sidebar" aria-label="Documentation sections">
        <a href="#overview">Overview</a>
        <a href="#web-ui">Web UI</a>
        <a href="#local-app">Local app</a>
        <a href="#cli">CLI</a>
        <a href="#node-api">Node API</a>
        <a href="#model">Model and runtime</a>
        <a href="#architecture">Architecture</a>
        <a href="#privacy">Privacy</a>
      </aside>

      <article class="content-page docs-page">
        <section id="overview" class="content-hero docs-hero">
          <div class="eyebrow">Documentation</div>
          <h2>Use bgcut in the browser, from the command line, or inside Node.</h2>
          <p>
            bgcut is one local background-removal system with four public surfaces: the hosted
            web app, the packaged local web app, the native CLI, and the reusable Node API.
          </p>
          <div class="hero-note">
            <span class="hero-note-dot" aria-hidden="true"></span>
            <span>Images stay on your machine. The model runs in your browser or local Node process.</span>
          </div>
          <div class="hero-actions">
            <a
              class="primary-link"
              href="/"
              onClick={(event) => {
                if (!shouldHandleInternalNavigation(event)) {
                  return;
                }

                event.preventDefault();
                props.onNavigate("home");
              }}
            >
              Open web app
            </a>
            <a class="secondary-link" href="https://www.npmjs.com/package/bgcut" target="_blank" rel="noreferrer">
              npm package
            </a>
          </div>
        </section>

        <section class="doc-section">
          <h3>Quick start</h3>
          <div class="doc-grid">
            <div class="doc-card">
              <div class="doc-card-label">Hosted web</div>
              <p>Open bgcut.dev, choose an image, and let the browser run inference locally.</p>
              <pre class="code-block"><code>https://bgcut.dev</code></pre>
            </div>
            <div class="doc-card">
              <div class="doc-card-label">Local web app</div>
              <p>Run the same UI from the npm package on a loopback server.</p>
              <pre class="code-block"><code>npx bgcut</code></pre>
            </div>
            <div class="doc-card">
              <div class="doc-card-label">CLI</div>
              <p>Use the file-in/file-out path for scripts and terminal workflows.</p>
              <pre class="code-block"><code>npx bgcut photo.jpg</code></pre>
            </div>
            <div class="doc-card">
              <div class="doc-card-label">Node API</div>
              <p>Keep one native ONNX Runtime session alive across many removals.</p>
              <pre class="code-block"><code>npm install bgcut</code></pre>
            </div>
          </div>
        </section>

        <section id="web-ui" class="doc-section">
          <div class="eyebrow">Web UI</div>
          <h3>The browser workflow</h3>
          <p>
            The product UI is intentionally small: choose or drag an image, wait for removal,
            compare the source and cutout, then copy, download, redo, or choose a new image.
            JPEG, PNG, WebP, and AVIF are supported.
          </p>
          <div class="shortcut-list" aria-label="Keyboard shortcuts">
            <div><kbd>N</kbd><span>New image</span></div>
            <div><kbd>C</kbd><span>Copy PNG</span></div>
            <div><kbd>D</kbd><span>Download PNG</span></div>
            <div><kbd>R</kbd><span>Redo removal</span></div>
            <div><kbd>←</kbd><kbd>→</kbd><span>Move focused comparison slider</span></div>
          </div>
          <p>
            The hosted app prefers ONNX Runtime WebGPU. If WebGPU inference cannot run, the
            browser can use ONNX Runtime WebAssembly instead. Image decode, preprocessing,
            inference, matte compositing, and export stay on the user's device.
          </p>
        </section>

        <section id="local-app" class="doc-section">
          <div class="eyebrow">Packaged local app</div>
          <h3>Run the web UI from npm</h3>
          <p>
            Running bgcut with no image starts the packaged UI on <code>127.0.0.1</code> using
            an available port and opens the browser.
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
            <code>serve --json</code> selects an available port, does not open a browser, and
            prints one JSON object with <code>url</code>, <code>host</code>, <code>port</code>,
            and <code>pid</code>. The server also exposes <code>/health</code>, the validated
            model route under <code>/models/...</code>, and the installed ONNX Runtime browser
            assets under <code>/runtime/...</code>.
          </p>
        </section>

        <section id="cli" class="doc-section">
          <div class="eyebrow">CLI</div>
          <h3>One image in, one image out</h3>
          <p>
            Passing an image selects the native headless path. The default output is a transparent
            PNG next to the input image. The explicit <code>remove</code> command is equivalent.
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
              <span role="cell">Try native WebGPU, then CPU if session creation fails</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell">GPU-only</strong>
              <span role="cell"><code>--gpu</code> never silently switches to CPU</span>
            </div>
          </div>
          <p>
            The native path uses Sharp/libvips to inspect image contents instead of trusting the
            filename extension alone. Format aliases such as <code>-png</code>, <code>-webp</code>,
            <code>-jpg</code>, <code>-gpu</code>, and <code>-cpu</code> are also accepted.
          </p>
        </section>

        <section id="node-api" class="doc-section">
          <div class="eyebrow">Node API</div>
          <h3>Reuse one inference session</h3>
          <p>
            Install bgcut as an application dependency and create an engine. One engine owns one
            native ONNX Runtime session and reuses it until <code>close()</code> is called.
          </p>
          <pre class="code-block"><code>{`import { writeFile } from "node:fs/promises";
import { createBgcut } from "bgcut";

const bgcut = await createBgcut();

try {
  const result = await bgcut.remove("photo.jpg", { format: "png" });
  await writeFile("photo-nobg.png", result.data);
} finally {
  await bgcut.close();
}`}</code></pre>

          <h4>createBgcut options</h4>
          <div class="spec-table" role="table" aria-label="Node API engines">
            <div class="spec-row" role="row">
              <strong role="cell"><code>auto</code></strong>
              <span role="cell">Try WebGPU, then CPU if the WebGPU session cannot start</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell"><code>gpu</code></strong>
              <span role="cell">Require native WebGPU</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell"><code>cpu</code></strong>
              <span role="cell">Require the CPU provider</span>
            </div>
          </div>

          <h4>Inputs and results</h4>
          <p>
            <code>remove()</code> accepts a file path, <code>Uint8Array</code>, or
            <code>ArrayBuffer</code>. The format can be <code>png</code>, <code>webp</code>, or
            <code>jpg</code>.
          </p>
          <pre class="code-block"><code>{`type BgcutRemovalResult = {
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
};`}</code></pre>
          <p>
            The engine also exposes <code>engine</code>, <code>fallbackReason</code>, and setup
            timing for model preparation and session creation.
          </p>
        </section>

        <section id="model" class="doc-section">
          <div class="eyebrow">Model and runtime</div>
          <h3>Pinned BiRefNet Lite 512</h3>
          <p>
            bgcut uses the <code>studioludens/birefnet-lite-512</code> model pinned to one source
            revision and one validated ONNX artifact.
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
            The large model is not bundled in the npm tarball. Native surfaces download it when
            needed, verify the expected artifact, and keep it in the operating-system user cache.
            The CLI, packaged local app, and Node API share that validated cache.
          </p>
        </section>

        <section id="architecture" class="doc-section">
          <div class="eyebrow">Architecture</div>
          <h3>One product, two runtime families</h3>
          <div class="architecture-grid">
            <div class="architecture-card">
              <strong>Browser path</strong>
              <span>Browser decode</span>
              <span>TypeGPU resize + ImageNet normalization</span>
              <span>ONNX Runtime WebGPU or WASM</span>
              <span>Matte readback + source-resolution compositing</span>
              <span>Transparent PNG export</span>
            </div>
            <div class="architecture-card">
              <strong>Native Node path</strong>
              <span>Sharp/libvips decode</span>
              <span>Shared preprocessing contract</span>
              <span>ONNX Runtime Node WebGPU or CPU</span>
              <span>Source-resolution matte compositing</span>
              <span>PNG, WebP, or JPG encode</span>
            </div>
          </div>
          <p>
            The hosted site is deployed on Cloudflare Workers. Static app assets are served by the
            Worker, while the pinned model and discrete ONNX Runtime browser files live in private
            R2 and are exposed through same-origin <code>/models/*</code> and
            <code>/runtime/*</code> routes.
          </p>
        </section>

        <section id="privacy" class="doc-section">
          <div class="eyebrow">Privacy</div>
          <h3>Your image is not an inference request to bgcut.dev</h3>
          <p>
            Source images, decoded pixels, masks, and generated outputs stay on the user's machine.
            The hosted Worker serves application and runtime files; it does not receive the source
            image or run image inference for the user.
          </p>
          <p>
            The native package may fetch the pinned model artifact when it is not already cached.
            That model download is separate from image processing.
          </p>
        </section>

        <section class="doc-section">
          <div class="eyebrow">More</div>
          <h3>Project links</h3>
          <div class="link-list">
            <a href="https://github.com/jhomra21/bgcut" target="_blank" rel="noreferrer">GitHub repository</a>
            <a href="https://www.npmjs.com/package/bgcut" target="_blank" rel="noreferrer">npm package</a>
            <a href="https://github.com/jhomra21/bgcut/releases" target="_blank" rel="noreferrer">Releases</a>
            <a href="https://github.com/jhomra21/bgcut/blob/main/README.md" target="_blank" rel="noreferrer">README</a>
          </div>
        </section>
      </article>
    </div>
  </main>
);

const PrivacyPage = () => (
  <main class="page-content legal-shell">
    <article class="legal-page">
      <div class="eyebrow">Privacy</div>
      <h2>Your images stay on your device.</h2>
      <p class="legal-updated">Last updated September 18, 2026</p>

      <section>
        <h3>Local image processing</h3>
        <p>
          bgcut is designed so source images, decoded pixels, masks, and generated outputs are
          processed on your device. The hosted web app runs inference in your browser. The packaged
          local app runs on loopback, and the CLI and Node API run in your local Node process.
        </p>
      </section>

      <section>
        <h3>Network requests</h3>
        <p>
          The hosted app requests its application files, ONNX Runtime files, and model artifact
          through bgcut.dev and Cloudflare infrastructure. Native use may download the pinned model
          from the bgcut GitHub release when it is not already cached. Those requests may expose
          ordinary request metadata such as IP address, user agent, timing, and requested URL to
          the infrastructure providers used to deliver those files.
        </p>
      </section>

      <section>
        <h3>No image upload service</h3>
        <p>
          bgcut does not operate a hosted image-inference endpoint for the product. Your source
          image is not sent to bgcut.dev for background removal.
        </p>
      </section>

      <section>
        <h3>Accounts, analytics, and cookies</h3>
        <p>
          The current bgcut application code has no account system, product analytics, telemetry,
          or application cookies. If that changes, this policy should be updated before the new
          collection is introduced.
        </p>
      </section>

      <section>
        <h3>Third-party services</h3>
        <p>
          Links to GitHub, npm, and other third-party services are governed by those services'
          privacy policies. Cloudflare and GitHub may process request metadata according to their
          own policies when they deliver bgcut assets or downloads.
        </p>
      </section>

      <section>
        <h3>Changes and questions</h3>
        <p>
          This policy may change as bgcut evolves. Material changes will be reflected on this page.
          Questions can be raised through the public bgcut GitHub repository.
        </p>
      </section>
    </article>
  </main>
);

const TermsPage = () => (
  <main class="page-content legal-shell">
    <article class="legal-page">
      <div class="eyebrow">Terms</div>
      <h2>Terms of use</h2>
      <p class="legal-updated">Last updated September 18, 2026</p>

      <section>
        <h3>Using bgcut</h3>
        <p>
          You may use bgcut and bgcut.dev for lawful purposes. You are responsible for the images
          you process and for having the rights or permission needed to use them.
        </p>
      </section>

      <section>
        <h3>Software license</h3>
        <p>
          bgcut's original source code is licensed under the MIT License. Third-party dependencies,
          vendored code, ONNX Runtime components, and model artifacts remain subject to their own
          licenses and terms.
        </p>
      </section>

      <section>
        <h3>No warranty</h3>
        <p>
          bgcut is provided as-is and without warranties of any kind to the extent permitted by
          law. Background-removal output can be imperfect, and the hosted service may change,
          become unavailable, or stop being offered.
        </p>
      </section>

      <section>
        <h3>Limitation of liability</h3>
        <p>
          To the extent permitted by law, the bgcut project and its contributors are not liable for
          indirect, incidental, special, consequential, or other damages arising from use of the
          software or hosted site.
        </p>
      </section>

      <section>
        <h3>Third-party software and services</h3>
        <p>
          bgcut relies on third-party software, hosting, package distribution, and model artifacts.
          Those components and services may have separate terms, licenses, and availability.
        </p>
      </section>

      <section>
        <h3>Changes</h3>
        <p>
          These terms may be updated as bgcut changes. Continued use after an update means you are
          using bgcut under the then-current terms.
        </p>
      </section>
    </article>
  </main>
);

const App = () => {
  const [page, setPage] = createSignal<SitePage>(currentPage());

  const navigate: Navigate = (nextPage) => {
    if (nextPage === page()) {
      return;
    }

    window.history.pushState(null, "", pathForPage(nextPage));
    setPage(nextPage);
    window.scrollTo(0, 0);
  };

  onSettled(() => {
    const handlePopState = () => {
      setPage(currentPage());
      window.scrollTo(0, 0);
    };

    window.addEventListener("popstate", handlePopState);

    return () => window.removeEventListener("popstate", handlePopState);
  });

  return (
    <div class="site-root">
      <div class="site-header-shell">
        <SiteHeader page={page()} onNavigate={navigate} />
      </div>

      <Show
        when={page() === "docs"}
        fallback={
          <Show
            when={page() === "privacy"}
            fallback={
              <Show when={page() === "terms"} fallback={<HomePage />}>
                <TermsPage />
              </Show>
            }
          >
            <PrivacyPage />
          </Show>
        }
      >
        <DocsPage onNavigate={navigate} />
      </Show>

      <div class="site-footer-shell">
        <SiteFooter onNavigate={navigate} />
      </div>
    </div>
  );
};

export default App;
