import { describe, expect, test } from "bun:test";

const appSource = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

const sourceInputBlock = (): string => {
  const start = appSource.indexOf('id="source-file-input"');

  if (start < 0) {
    throw new Error("Could not find source-file-input in App.tsx.");
  }

  const end = appSource.indexOf("/>", start);

  if (end < 0) {
    throw new Error("Could not find the end of source-file-input in App.tsx.");
  }

  return appSource.slice(start, end);
};

describe("browser product UI", () => {
  test("uses one image picker with the supported browser formats", () => {
    const input = sourceInputBlock();

    expect(input).toContain("image/png");
    expect(input).toContain("image/jpeg");
    expect(input).toContain("image/webp");
    expect(input).toContain("image/avif");
    expect(appSource.match(/type="file"/gu)?.length).toBe(1);
  });

  test("matches the minimal product flow", () => {
    expect(appSource).toContain('class="brand-title"');
    expect(appSource).toContain('src="/favicon-48x48.png?v=2"');
    expect(appSource).toContain("<span>bgcut</span>");
    expect(appSource).toContain('class="brand-link"');
    expect(appSource).toContain('aria-label="bgcut home"');
    expect(appSource).toContain('props.onNavigate("home")');
    expect(appSource).not.toContain("drop-trigger-mark");
    expect(appSource).not.toContain(">\n        App\n      </a>");
    expect(appSource).toContain('href="https://github.com/jhomra21/bgcut"');
    expect(appSource).toContain("GitHub");
    expect(appSource).toContain("Click or drag image here");
    expect(appSource).toContain("onClick={handleSurfaceClick}");
    expect(appSource).toContain("event.target !== event.currentTarget");
    expect(appSource).toContain("New Image");
    expect(appSource).toContain("Copy");
    expect(appSource).toContain("Download");
    expect(appSource).toContain("Redo");
    expect(appSource).toContain('aria-keyshortcuts="N"');
    expect(appSource).toContain('aria-keyshortcuts="C"');
    expect(appSource).toContain('aria-keyshortcuts="D"');
    expect(appSource).toContain('aria-keyshortcuts="R"');
    expect(appSource).toContain("handleKeyboardShortcut");
    expect(appSource).toContain('window.addEventListener("keydown", handleKeyboardShortcut)');
    expect(appSource).toContain('aria-keyshortcuts="Meta+O Control+O"');
    expect(appSource).toContain('aria-keyshortcuts="Meta+V Control+V"');
    expect(appSource).toContain("handlePaste");
    expect(appSource).toContain('window.addEventListener("paste", handlePaste)');
    expect(appSource).toContain('item.type.startsWith("image/")');
    expect(appSource).toContain('aria-label="Choose image shortcut, Command O"');
    expect(appSource).toContain("or paste");
    expect(appSource).toContain("JPEG, PNG, WebP, or AVIF");
    expect(appSource).not.toContain("· JPEG, PNG, WebP, or AVIF");
    expect(appSource).toContain("disabled={processing()}");
    expect(appSource).not.toContain(">Reset<");
    expect(appSource).not.toContain("Remove background");
  });


  test("keeps the packaged local app on the root tool shell only", () => {
    expect(appSource).toContain("LOCAL_RUNTIME_META_SELECTOR");
    expect(appSource).toContain('meta[name="bgcut-runtime"][content="local"]');
    expect(appSource).toContain("const LocalAppHeader = () => (");

    const localStart = appSource.indexOf("if (isLocalRuntime())");
    const hostedStart = appSource.indexOf("const initialPage = currentPage()", localStart);

    expect(localStart).toBeGreaterThanOrEqual(0);
    expect(hostedStart).toBeGreaterThan(localStart);

    const localBranch = appSource.slice(localStart, hostedStart);

    expect(localBranch).toContain("<LocalAppHeader />");
    expect(localBranch).toContain('class="site-root local-app-root"');
    expect(localBranch).toContain("<HomePage />");
    expect(localBranch).not.toContain("<SiteHeader");
    expect(localBranch).not.toContain("<SiteFooter");
    expect(localBranch).not.toContain("<DocsPage");
    expect(localBranch).not.toContain("<PrivacyPage");
    expect(localBranch).not.toContain("<TermsPage");
  });

  test("exposes docs plus footer-only legal pages without an about surface", () => {
    expect(appSource).toContain('pathname === "/docs"');
    expect(appSource).toContain('pathname === "/privacy"');
    expect(appSource).toContain('pathname === "/terms"');
    expect(appSource).toContain('href="/docs"');
    expect(appSource).toContain('href="/privacy"');
    expect(appSource).toContain('href="/terms"');
    expect(appSource).not.toContain('pathname === "/about"');
    expect(appSource).not.toContain('href="/about"');
    expect(appSource).not.toContain("AboutPage");
    expect(appSource).toContain("SiteFooter");
    expect(appSource).toContain('class="site-footer-brand brand-link"');
    expect(appSource).toContain("MIT licensed");
    expect(appSource).not.toContain('class="docs-intro"');
    expect(appSource).not.toContain('<section id="privacy" class="doc-section">');
    expect(appSource).toContain("Local app");
    expect(appSource).toContain("Node API");
    expect(appSource).toContain('import { createBgcut } from "bgcut"');
    expect(appSource).toContain("birefnet-lite-512-ort-basic-webgpu-v2.onnx");
  });

  test("uses one symmetric two-phase route transition for every internal page", () => {
    expect(appSource).toContain("const ROUTE_FADE_MS = 75");
    expect(appSource).toContain('type RouteTransitionPhase = "idle" | "out" | "in"');
    expect(appSource).toContain('setRoutePhase("out")');
    expect(appSource).toContain('setRoutePhase("in")');
    expect(appSource).toContain('setRoutePhase("idle")');
    expect(appSource).toContain("window.setTimeout");
    expect(appSource.match(/window\.setTimeout/gu)?.length).toBe(2);
    expect(appSource).toContain('transitionTo(currentPage(), "none")');
    expect(appSource).toContain('const navigate: Navigate = (nextPage) => transitionTo(nextPage, "push")');
    expect(appSource).toContain("window.history.pushState");
    expect(appSource).toContain('window.addEventListener("popstate", handlePopState)');
    expect(appSource).toContain("route-stage route-stage-");
    expect(appSource).toContain('<SiteHeader page={page()} onNavigate={navigate} />');
    expect(appSource).toContain('<SiteFooter onNavigate={navigate} />');
  });

  test("tracks the nearest visible docs heading during manual scroll", () => {
    expect(appSource).toContain("const readingPosition = (): number => window.innerHeight * 0.42");
    expect(appSource).toContain("let closestDistance = Number.POSITIVE_INFINITY");
    expect(appSource).toContain("rect.bottom <= 0 || rect.top >= window.innerHeight");
    expect(appSource).toContain("const distance = Math.abs(rect.top - marker)");
    expect(appSource).toContain("distance < closestDistance");
    expect(appSource).toContain("nextSection = section.id");
    expect(appSource).not.toContain("resourcesRect.top < window.innerHeight");
    expect(appSource).toContain('activeSection() === section ? "location" : undefined');
    expect(appSource).toContain('aria-current={current("architecture")}');
    expect(appSource).toContain('aria-current={current("resources")}');
    expect(appSource).toContain('window.addEventListener("scroll", pickActiveSection, { passive: true })');
  });

  test("lets Resources own only the true manual document bottom", () => {
    expect(appSource).toContain("let suppressBottomResourceUntil = 0");
    expect(appSource).toContain("const atDocumentBottom = Math.abs(window.scrollY - maxScrollY) <= 2");
    expect(appSource).toContain("const resourcesVisible = sections.some");
    expect(appSource).toContain("performance.now() >= suppressBottomResourceUntil");
    expect(appSource).toContain('nextSection = "resources"');
    expect(appSource).toContain('section === "resources" ? 0 : performance.now() + DOCS_SCROLL_MS + 120');
  });

  test("keeps click highlighting only for the 120ms programmatic scroll", () => {
    expect(appSource).toContain("const DOCS_SCROLL_MS = 120");
    expect(appSource).toContain("let programmaticTarget: DocsSectionId | undefined");
    expect(appSource).toContain("let scrollAnimationFrame: number | undefined");
    expect(appSource).toContain("const animateScrollTo = (targetY: number, section: DocsSectionId)");
    expect(appSource).toContain("const desiredY = sectionTop - Math.min(160, window.innerHeight * 0.22)");
    expect(appSource).toContain("programmaticTarget = section");
    expect(appSource).toContain("programmaticTarget = undefined");
    expect(appSource).toContain("pickActiveSection()");
    expect(appSource).toContain("easeOutCubic(progress)");
    expect(appSource).toContain("(now - startedAt) / DOCS_SCROLL_MS");
    expect(appSource).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(appSource).not.toContain("let pinnedSection");
    expect(appSource).not.toContain('target.scrollIntoView({ behavior: "smooth", block })');
    expect(appSource).toContain('window.addEventListener("wheel", releaseProgrammaticScroll, { passive: true })');
    expect(appSource).toContain('window.addEventListener("touchstart", releaseProgrammaticScroll, { passive: true })');
    expect(appSource).toContain('onClick={(event) => navigateToSection(event, "model")}');
    expect(appSource).toContain('onClick={(event) => navigateToSection(event, "architecture")}');
  });

  test("documents the shipped public interfaces", () => {
    expect(appSource).toContain("bgcut serve --json");
    expect(appSource).toContain("bgcut photo.jpg --gpu");
    expect(appSource).toContain("bgcut photo.jpg --cpu");
    expect(appSource).toContain('engine: "webgpu" | "cpu"');
    expect(appSource).toContain("195,872,736 bytes");
    expect(appSource).toContain("4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c");
    expect(appSource).toContain("The CLI, local app, and");
    expect(appSource).toContain("verify");
    expect(appSource).toContain("SHA-256");
  });



  test("documents the hosted-site versus packaged-local distinction", () => {
    expect(appSource).toContain("The local UI contains the bgcut brand and removal workflow only");
    expect(appSource).toContain("Docs, GitHub");
    expect(appSource).toContain("Privacy, Terms, and the site footer remain on bgcut.dev");
    expect(appSource).toContain("Non-root app routes redirect to <code>/</code>");
    expect(appSource).toContain("without the hosted site's navigation");
  });

  test("keeps website documentation aligned with the shipped runtime behavior", () => {
    expect(appSource).toContain("If <code>--port</code> is omitted");
    expect(appSource).toContain("The local UI contains the bgcut brand and removal workflow only");
    expect(appSource).toContain("WebGPU input uses TypeGPU resize and ImageNet normalization");
    expect(appSource).toContain("WebAssembly input uses canvas resize and the same normalization");
    expect(appSource).toContain("Sharp/libvips decode and orientation");
    expect(appSource).toContain("Linear resize and ImageNet normalization");
    expect(appSource).toContain("Last updated September 19, 2026");
    expect(appSource.match(/Last updated September 19, 2026/gu)?.length).toBe(2);
    expect(appSource).not.toContain("The product UI is intentionally small");
    expect(appSource).not.toContain("Native surfaces");
  });

  test("keeps developer diagnostics and external comparison controls out of the product UI", () => {
    const internalComparisonName = ["B", "G", "0"].join("");

    expect(appSource).not.toContain("diagnostics");
    expect(appSource).not.toContain("Pipeline timing");
    expect(appSource).not.toContain("Execution path");
    expect(appSource).not.toContain("reference-file-input");
    expect(appSource).not.toContain(internalComparisonName);
  });
});
