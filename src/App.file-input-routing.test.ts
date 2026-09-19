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

  test("tracks the documentation section actually being read", () => {
    expect(appSource).toContain("const DOC_SECTION_IDS");
    expect(appSource).toContain("const viewportHeight = window.innerHeight");
    expect(appSource).toContain("const readingPoint = viewportHeight * 0.42");
    expect(appSource).toContain('const resources = sections.find((section) => section.id === "resources")');
    expect(appSource).toContain("resourcesRect.top <= viewportHeight * 0.68");
    expect(appSource).toContain('section.id === "resources"');
    expect(appSource).toContain("rect.top <= readingPoint && rect.bottom >= readingPoint");
    expect(appSource).toContain("const visibleTop = Math.max(rect.top, 0)");
    expect(appSource).toContain("const visibleBottom = Math.min(rect.bottom, viewportHeight)");
    expect(appSource).toContain('activeSection() === section ? "location" : undefined');
    expect(appSource).toContain('aria-current={current("quickstart")}');
    expect(appSource).toContain('aria-current={current("architecture")}');
    expect(appSource).toContain('aria-current={current("resources")}');
    expect(appSource).toContain('window.addEventListener("scroll", pickActiveSection, { passive: true })');
    expect(appSource).not.toContain("viewportBottom >= documentBottom - 2");
    expect(appSource).toContain('setActiveSection("resources")');
    expect(appSource).not.toContain("new IntersectionObserver");
    expect(appSource).not.toContain('aria-current={current("privacy")}');
    expect(appSource).not.toContain('aria-current={current("overview")}');
  });


  test("keeps sidebar clicks pinned and caps scroll animation below 150ms", () => {
    expect(appSource).toContain("const DOCS_SCROLL_MS = 120");
    expect(appSource).toContain("let pinnedSection: DocsSectionId | undefined");
    expect(appSource).toContain("let scrollAnimationFrame: number | undefined");
    expect(appSource).toContain("const animateScrollTo = (targetY: number)");
    expect(appSource).toContain("easeOutCubic(progress)");
    expect(appSource).toContain("(now - startedAt) / DOCS_SCROLL_MS");
    expect(appSource).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(appSource).toContain("pinnedSection = section");
    expect(appSource).toContain("setActiveSection(section)");
    expect(appSource).toContain('section === "model" || section === "architecture" || section === "resources"');
    expect(appSource).not.toContain('target.scrollIntoView({ behavior: "smooth", block })');
    expect(appSource).toContain('window.addEventListener("wheel", releasePinnedSection, { passive: true })');
    expect(appSource).toContain('window.addEventListener("touchstart", releasePinnedSection, { passive: true })');
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
    expect(appSource).toContain("The CLI, packaged local app, and Node API share that validated cache.");
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
