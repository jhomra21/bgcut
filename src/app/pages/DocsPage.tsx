import { createSignal, onSettled } from "solid-js";

import { shouldHandleInternalNavigation } from "../navigation";

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

    if (window.scrollY <= 2) {
      setActiveSection("quickstart");

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

export const DocsPage = () => (
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
