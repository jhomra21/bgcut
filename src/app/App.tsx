import { Effect } from "effect";
import { Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";

import ComparisonSlider from "./components/ComparisonSlider";
import { formatBackgroundRemovalError, formatImageError } from "../engine/errors";
import { removeBackground } from "../engine/inference";
import { decodeImage } from "../engine/image";

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

const LOCAL_RUNTIME_META_SELECTOR = 'meta[name="bgcut-runtime"][content="local"]';

const isLocalRuntime = (): boolean =>
  document.querySelector(LOCAL_RUNTIME_META_SELECTOR) !== null;

type Navigate = (page: SitePage) => void;

type RouteTransitionPhase = "idle" | "out" | "in";

type HistoryMode = "push" | "none";

const ROUTE_FADE_MS = 75;

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

const LocalAppHeader = () => (
  <header class="app-header">
    <div class="brand-link">
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
    </div>
  </header>
);

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
      <a
        class="site-footer-brand brand-link"
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
        <img
          class="brand-mark"
          src="/favicon-48x48.png?v=2"
          alt=""
          width="22"
          height="22"
          aria-hidden="true"
        />
        <span>bgcut</span>
      </a>
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

const DOC_SECTION_IDS = [
  "quickstart",
  "web-ui",
  "local-app",
  "cli",
  "node-api",
  "model",
  "architecture",
  "resources",
] as const;

type DocsSectionId = (typeof DOC_SECTION_IDS)[number];

const isDocsSectionId = (sectionId: string): sectionId is DocsSectionId =>
  DOC_SECTION_IDS.some((candidate) => candidate === sectionId);

const DOCS_SCROLL_MS = 120;

const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

const DocsSidebar = () => {
  const [activeSection, setActiveSection] = createSignal<DocsSectionId>("quickstart");
  let programmaticTarget: DocsSectionId | undefined;
  let scrollAnimationFrame: number | undefined;
  let suppressBottomResourceUntil = 0;

  const docsSections = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".docs-page > section[id]"),
    ).filter((section) => isDocsSectionId(section.id));

  const readingPosition = (): number => window.innerHeight * 0.42;

  const cancelScrollAnimation = () => {
    if (scrollAnimationFrame !== undefined) {
      window.cancelAnimationFrame(scrollAnimationFrame);
      scrollAnimationFrame = undefined;
    }

    programmaticTarget = undefined;
  };

  const pickActiveSection = () => {
    if (programmaticTarget !== undefined) {
      setActiveSection(programmaticTarget);

      return;
    }

    const sections = docsSections();
    const marker = readingPosition();
    let nextSection: DocsSectionId = "quickstart";
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const section of sections) {
      if (!isDocsSectionId(section.id)) {
        continue;
      }

      const rect = section.getBoundingClientRect();

      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        continue;
      }

      const distance = Math.abs(rect.top - marker);

      if (distance < closestDistance) {
        closestDistance = distance;
        nextSection = section.id;
      }
    }

    const maxScrollY = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );

    const atDocumentBottom = Math.abs(window.scrollY - maxScrollY) <= 2;

    const resourcesVisible = sections.some((section) => {
      if (section.id !== "resources") {
        return false;
      }

      const rect = section.getBoundingClientRect();

      return rect.bottom > 0 && rect.top < window.innerHeight;
    });

    if (
      atDocumentBottom &&
      resourcesVisible &&
      performance.now() >= suppressBottomResourceUntil
    ) {
      nextSection = "resources";
    }

    setActiveSection(nextSection);
  };

  const releaseProgrammaticScroll = () => {
    if (programmaticTarget === undefined && scrollAnimationFrame === undefined) {
      return;
    }

    cancelScrollAnimation();
    pickActiveSection();
  };

  const handleScrollKey = (event: KeyboardEvent) => {
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "PageDown" ||
      event.key === "PageUp" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === " "
    ) {
      releaseProgrammaticScroll();
    }
  };

  const animateScrollTo = (targetY: number, section: DocsSectionId) => {
    cancelScrollAnimation();
    programmaticTarget = section;
    suppressBottomResourceUntil =
      section === "resources" ? 0 : performance.now() + DOCS_SCROLL_MS + 120;
    setActiveSection(section);

    const startY = window.scrollY;
    const distance = targetY - startY;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || Math.abs(distance) < 1) {
      window.scrollTo(0, targetY);
      programmaticTarget = undefined;
      pickActiveSection();

      return;
    }

    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / DOCS_SCROLL_MS, 1);
      window.scrollTo(0, startY + distance * easeOutCubic(progress));

      if (progress < 1) {
        scrollAnimationFrame = window.requestAnimationFrame(tick);

        return;
      }

      scrollAnimationFrame = undefined;
      programmaticTarget = undefined;
      pickActiveSection();
    };

    scrollAnimationFrame = window.requestAnimationFrame(tick);
  };

  onSettled(() => {
    window.addEventListener("scroll", pickActiveSection, { passive: true });
    window.addEventListener("wheel", releaseProgrammaticScroll, { passive: true });
    window.addEventListener("touchstart", releaseProgrammaticScroll, { passive: true });
    window.addEventListener("keydown", handleScrollKey);
    window.addEventListener("resize", pickActiveSection);
    pickActiveSection();

    return () => {
      cancelScrollAnimation();
      window.removeEventListener("scroll", pickActiveSection);
      window.removeEventListener("wheel", releaseProgrammaticScroll);
      window.removeEventListener("touchstart", releaseProgrammaticScroll);
      window.removeEventListener("keydown", handleScrollKey);
      window.removeEventListener("resize", pickActiveSection);
    };
  });

  const current = (section: DocsSectionId): "location" | undefined =>
    activeSection() === section ? "location" : undefined;

  const navigateToSection = (event: MouseEvent, section: DocsSectionId) => {
    if (!shouldHandleInternalNavigation(event)) {
      return;
    }

    const target = document.getElementById(section);

    if (target === null) {
      return;
    }

    event.preventDefault();
    window.history.replaceState(null, "", `#${section}`);

    const sectionTop = window.scrollY + target.getBoundingClientRect().top;
    const desiredY = sectionTop - Math.min(160, window.innerHeight * 0.22);

    const maxScrollY = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );

    animateScrollTo(Math.min(Math.max(desiredY, 0), maxScrollY), section);
  };

  return (
    <aside class="docs-sidebar" aria-label="Documentation sections">
      <div class="docs-sidebar-group">
        <span class="docs-sidebar-label">Start</span>
        <a
          href="#quickstart"
          aria-current={current("quickstart")}
          onClick={(event) => navigateToSection(event, "quickstart")}
        >
          Quickstart
        </a>
      </div>

      <div class="docs-sidebar-group">
        <span class="docs-sidebar-label">Use</span>
        <a
          href="#web-ui"
          aria-current={current("web-ui")}
          onClick={(event) => navigateToSection(event, "web-ui")}
        >
          Web UI
        </a>
        <a
          href="#local-app"
          aria-current={current("local-app")}
          onClick={(event) => navigateToSection(event, "local-app")}
        >
          Local app
        </a>
        <a
          href="#cli"
          aria-current={current("cli")}
          onClick={(event) => navigateToSection(event, "cli")}
        >
          CLI
        </a>
        <a
          href="#node-api"
          aria-current={current("node-api")}
          onClick={(event) => navigateToSection(event, "node-api")}
        >
          Node API
        </a>
      </div>

      <div class="docs-sidebar-group">
        <span class="docs-sidebar-label">Reference</span>
        <a
          href="#model"
          aria-current={current("model")}
          onClick={(event) => navigateToSection(event, "model")}
        >
          Model & runtime
        </a>
        <a
          href="#architecture"
          aria-current={current("architecture")}
          onClick={(event) => navigateToSection(event, "architecture")}
        >
          Architecture
        </a>
        <a
          href="#resources"
          aria-current={current("resources")}
          onClick={(event) => navigateToSection(event, "resources")}
        >
          Resources
        </a>
      </div>
    </aside>
  );
};

const DocsPage = () => (
  <main class="page-content content-shell">
    <div class="content-layout">
      <DocsSidebar />

      <article class="content-page docs-page">
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
            The local UI contains the bgcut brand and removal workflow only. Docs, GitHub
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
            Install bgcut as an application dependency, then call <code>createBgcut()</code>.
            Each created engine owns one ONNX Runtime session and reuses it until
            <code>close()</code>.
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
              <span role="cell">Create a WebGPU session first, then use CPU if creation fails</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell"><code>gpu</code></strong>
              <span role="cell">Require a WebGPU session</span>
            </div>
            <div class="spec-row" role="row">
              <strong role="cell"><code>cpu</code></strong>
              <span role="cell">Require a CPU session</span>
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
            The returned engine also reports the selected <code>engine</code>, any
            <code>fallbackReason</code>, and setup timings for model preparation and session
            creation.
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
      <p class="legal-updated">Last updated September 19, 2026</p>

      <section>
        <h3>Image processing</h3>
        <p>
          The hosted app runs background removal in your browser. The local app serves the same
          removal workflow from <code>127.0.0.1</code> without the hosted site's navigation,
          documentation, or legal pages. Image inference still runs in the browser. The CLI and
          Node API process images in the local Node process. bgcut does not send source images,
          decoded pixels, masks, or generated outputs to a bgcut inference service.
        </p>
      </section>

      <section>
        <h3>Network requests</h3>
        <p>
          The hosted app fetches its app files, ONNX Runtime files, and pinned model from bgcut.dev
          through Cloudflare. The CLI, local app server, and Node API may download the pinned model
          from a bgcut GitHub release when the local cache is missing or invalid. Cloudflare and
          GitHub can receive request metadata such as IP address, user agent, requested URL, and
          request time.
        </p>
      </section>

      <section>
        <h3>Accounts, cookies, and analytics</h3>
        <p>
          bgcut's application code does not create accounts, set application cookies, or send
          product analytics or telemetry.
        </p>
      </section>

      <section>
        <h3>Third-party services</h3>
        <p>
          GitHub and npm links take you to third-party sites. Cloudflare delivers bgcut.dev, and
          GitHub serves native model downloads. Their privacy policies apply to those requests.
        </p>
      </section>

      <section>
        <h3>Changes and questions</h3>
        <p>
          The date above changes when this policy changes. Open an issue in the bgcut GitHub
          repository with privacy questions.
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
      <p class="legal-updated">Last updated September 19, 2026</p>

      <section>
        <h3>Scope</h3>
        <p>
          These terms cover bgcut.dev and other services operated by the bgcut project. The MIT
          License governs bgcut's original source code.
        </p>
      </section>

      <section>
        <h3>Your use</h3>
        <p>
          Use bgcut only for lawful purposes and only with images you have the right to process.
          You are responsible for the images you choose and how you use the output.
        </p>
      </section>

      <section>
        <h3>Software licenses</h3>
        <p>
          bgcut's original source code is licensed under the MIT License. Third-party dependencies,
          vendored code, ONNX Runtime components, and model files keep their own licenses and terms.
        </p>
      </section>

      <section>
        <h3>No warranty</h3>
        <p>
          bgcut and bgcut.dev are provided "as is" without warranties to the extent permitted by
          law. Background removal can produce incorrect results. The hosted site may change or
          become unavailable.
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
          Third-party software and services have their own licenses and terms. Those rules apply
          when you use them.
        </p>
      </section>

      <section>
        <h3>Changes</h3>
        <p>
          Changes to these terms take effect when posted here. The date above shows the current
          version.
        </p>
      </section>
    </article>
  </main>
);

const App = () => {
  if (isLocalRuntime()) {
    return (
      <div class="site-root local-app-root">
        <div class="site-header-shell">
          <LocalAppHeader />
        </div>
        <HomePage />
      </div>
    );
  }

  const initialPage = currentPage();
  const [page, setPage] = createSignal<SitePage>(initialPage);
  const [routePhase, setRoutePhase] = createSignal<RouteTransitionPhase>("idle");
  let routeTarget = initialPage;
  let transitionTimer: number | undefined;
  let transitionVersion = 0;

  const clearRouteTransition = () => {
    if (transitionTimer !== undefined) {
      window.clearTimeout(transitionTimer);
      transitionTimer = undefined;
    }
  };

  const transitionTo = (nextPage: SitePage, historyMode: HistoryMode) => {
    if (nextPage === routeTarget && routePhase() !== "idle") {
      return;
    }

    if (nextPage === page() && routePhase() === "idle") {
      return;
    }

    routeTarget = nextPage;
    clearRouteTransition();
    transitionVersion += 1;
    const version = transitionVersion;

    if (nextPage === page()) {
      setRoutePhase("idle");

      return;
    }

    setRoutePhase("out");

    transitionTimer = window.setTimeout(() => {
      if (version !== transitionVersion) {
        return;
      }

      transitionTimer = undefined;

      if (historyMode === "push") {
        window.history.pushState(null, "", pathForPage(nextPage));
      }

      setPage(nextPage);
      window.scrollTo(0, 0);
      setRoutePhase("in");

      transitionTimer = window.setTimeout(() => {
        if (version !== transitionVersion) {
          return;
        }

        transitionTimer = undefined;
        setRoutePhase("idle");
      }, ROUTE_FADE_MS);
    }, ROUTE_FADE_MS);
  };

  const navigate: Navigate = (nextPage) => transitionTo(nextPage, "push");

  onSettled(() => {
    const handlePopState = () => {
      transitionTo(currentPage(), "none");
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      transitionVersion += 1;
      clearRouteTransition();
    };
  });

  return (
    <div class="site-root">
      <div class="site-header-shell">
        <SiteHeader page={page()} onNavigate={navigate} />
      </div>

      <div class={`route-stage route-stage-${routePhase()}`}>
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
          <DocsPage />
        </Show>
      </div>

      <div class="site-footer-shell">
        <SiteFooter onNavigate={navigate} />
      </div>
    </div>
  );
};

export default App;
