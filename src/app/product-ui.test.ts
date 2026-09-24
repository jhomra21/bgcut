import { describe, expect, test } from "bun:test";

const appSourcePaths = [
  "./App.tsx",
  "./components/ReferencePage.tsx",
  "./components/SectionRail.tsx",
  "./components/SiteChrome.tsx",
  "./navigation.ts",
  "./pages/HomePage.tsx",
  "./pages/ChangelogPage.tsx",
  "./pages/DocsPage.tsx",
  "./pages/PrivacyPage.tsx",
  "./pages/TermsPage.tsx",
] as const;

const appSource = (
  await Promise.all(
    appSourcePaths.map((path) => Bun.file(new URL(path, import.meta.url)).text()),
  )
).join("\n");

const appComponentSource = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

const homeSource = await Bun.file(new URL("./pages/HomePage.tsx", import.meta.url)).text();

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
    expect(localBranch).not.toContain("<ChangelogPage");
    expect(localBranch).not.toContain("<PrivacyPage");
    expect(localBranch).not.toContain("<TermsPage");
  });

  test("exposes docs plus footer-only legal pages without an about surface", () => {
    expect(appSource).toContain('pathname === "/docs"');
    expect(appSource).toContain('pathname === "/changelog"');
    expect(appSource).toContain('pathname === "/privacy"');
    expect(appSource).toContain('pathname === "/terms"');
    expect(appSource).toContain('href="/docs"');
    expect(appSource).toContain('href="/changelog"');
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
    expect(appSource).toContain('import { removeBackground } from "bgcut"');
    expect(appSource).toContain('import { createBgcut } from "bgcut"');
    expect(appSource).toContain('import { BgcutError, removeBackground } from "bgcut"');
    expect(appSource).toContain("RemoveBackgroundResult");
    expect(appSource).toContain("../../../CHANGELOG.md?raw");
    expect(appSource).toContain("birefnet-lite-512-ort-basic-webgpu-v2.onnx");
  });

  test("shows only published release entries on the public changelog", () => {
    expect(appSource).toContain("const releaseHeading");
    expect(appSource).toContain("releaseHeading.test(heading)");
    expect(appSource).not.toContain('<div class="eyebrow">Releases</div>');
    expect(appSource).not.toContain("document.intro");
  });

  test("tracks published changelog releases with the shared reading rail", () => {
    expect(appSource).toContain("const releaseId = (version: string)");
    expect(appSource).toContain("const releaseItems: SectionRailItem[] = []");
    expect(appSource).toContain('label: "History"');
    expect(appSource).toContain('railAriaLabel="Changelog history"');
    expect(appSource).toContain('sectionSelector=".reference-page > section[id]"');
    expect(appSource).toContain("bottomSectionId={oldestReleaseId}");
    expect(appSource).toContain('id={section.id} class="reference-section changelog-release"');
  });

  test("keeps top navigation geometry stable and moves selection immediately", () => {
    expect(appSource).toContain('class="site-nav-indicator"');
    expect(appSource).toContain('data-active={props.page}');
    expect(appSource).toContain('class="site-nav-docs"');
    expect(appSource).toContain('class="site-nav-changelog"');
    expect(appSource).toContain('class="site-nav-github"');
    expect(appSource).toContain("const [navPage, setNavPage] = createSignal<SitePage>(initialPage)");
    expect(appSource).toContain("setNavPage(nextPage)");
    expect(appSource).toContain('<SiteHeader page={navPage()} onNavigate={navigate} />');
    expect(appSource).not.toContain("headerScrolled");
    expect(appSource).not.toContain("showPageContext");
    expect(appSource).not.toContain("site-page-context");
  });

  test("keeps the reference page title permanently in the reading rail", () => {
    expect(appSource).toContain('<h1 class="section-rail-page-title">{props.pageTitle}</h1>');
    expect(appSource).not.toContain("TITLE_FADE_MS");
    expect(appSource).not.toContain("TitleTransitionPhase");
    expect(appSource).not.toContain("compactTitle");
    expect(appSource).not.toContain("titlePhase");
    expect(appSource).not.toContain("onPageTitleVisibilityChange");
    expect(appSource).not.toContain("TITLE_REVEAL_GAP");
    expect(appSource).not.toContain("reference-page-title");
    expect(appSource).not.toContain("reference-page-header");
    expect(appSource).not.toContain("reference-title-fade");
    expect(appSource).not.toContain("reference-title-motion");
    expect(appSource).not.toContain("startViewTransition");
    expect(appSource).not.toContain("view-transition-name");
  });

  test("uses one symmetric two-phase route transition for every internal page", () => {
    expect(appSource).toContain("const ROUTE_FADE_MS = 75");
    expect(appSource).toContain('type RouteTransitionPhase = "idle" | "out" | "in"');
    expect(appSource).toContain('setRoutePhase("out")');
    expect(appSource).toContain('setRoutePhase("in")');
    expect(appSource).toContain('setRoutePhase("idle")');
    expect(appSource).toContain("window.setTimeout");
    expect(appComponentSource.match(/window\.setTimeout/gu)?.length).toBe(2);
    expect(appSource).toContain('transitionTo(currentPage(), "none")');
    expect(appSource).toContain('const navigate: Navigate = (nextPage) => transitionTo(nextPage, "push")');
    expect(appSource).toContain("window.history.pushState");
    expect(appSource).toContain('window.addEventListener("popstate", handlePopState)');
    expect(appSource).toContain("route-stage route-stage-");
    expect(appSource).toContain('<SiteHeader page={navPage()} onNavigate={navigate} />');
    expect(appSource).toContain('<SiteFooter onNavigate={navigate} />');
  });

  test("keeps docs and changelog on one shared reference-page shell", () => {
    expect(appSource).toContain("content-page reference-page ${props.pageClass}");
    expect(appSource).toContain('title="Documentation"');
    expect(appSource).toContain("title={document.title}");
    expect(appSource).toContain('pageClass="docs-page"');
    expect(appSource).toContain('pageClass="changelog-page"');
    expect(appSource).toContain('class="reference-section doc-section');
    expect(appSource).toContain('class="reference-section changelog-release"');
    expect(appSource).not.toContain('class="docs-page-header"');
    expect(appSource).not.toContain('class="changelog-header"');
    expect(appSource).not.toContain('class="reference-page-header"');
    expect(appSource).not.toContain('class="reference-page-title"');
    expect(appSource).not.toContain("<h1>Documentation</h1>");
    expect(appSource).not.toContain('<div class="eyebrow">Documentation</div>');
    expect(appSource).not.toContain("Browser, CLI and Node.js background removal");
    expect(appSource).not.toContain(
      "Use bgcut as a private browser background remover, a local command-line tool, or a Node.js background removal API."
    );
  });

  test("keeps each reading rail on its first section at the page top", () => {
    expect(appSource).toContain("if (window.scrollY <= 2)");
    expect(appSource).toContain("setActiveSection(props.initialSectionId)");
    expect(appSource).toContain('initialSectionId="quickstart"');
    expect(appSource).toContain("initialSectionId={latestReleaseId}");
  });

  test("tracks the section containing the shared viewport reading position", () => {
    expect(appSource).toContain("const readingPosition = (): number => window.innerHeight * 0.34");
    expect(appSource).toContain("let closestDistance = Number.POSITIVE_INFINITY");
    expect(appSource).toContain("rect.bottom <= 0 || rect.top >= window.innerHeight");
    expect(appSource).toContain("rect.top <= marker && rect.bottom >= marker");
    expect(appSource).toContain("marker < rect.top ? rect.top - marker : Math.max(marker - rect.bottom, 0)");
    expect(appSource).toContain("distance < closestDistance");
    expect(appSource).toContain("nextSection = section.id");
    expect(appSource).toContain('activeSection() === sectionId ? "location" : undefined');
    expect(appSource).toContain('window.addEventListener("scroll", pickActiveSection, { passive: true })');
    expect(appSource).toContain('sectionSelector=".reference-page > section[id]"');
    expect(appSource.match(/sectionSelector="\.reference-page > section\[id\]"/gu)?.length).toBe(1);
  });

  test("lets each configured final section own the true manual page bottom", () => {
    expect(appSource).toContain("let suppressBottomSectionUntil = 0");
    expect(appSource).toContain("const bottomSectionId = props.bottomSectionId");
    expect(appSource).toContain("const atDocumentBottom = Math.abs(window.scrollY - maxScrollY) <= 2");
    expect(appSource).toContain("let bottomSectionVisible = false");
    expect(appSource).toContain("performance.now() >= suppressBottomSectionUntil");
    expect(appSource).toContain("nextSection = bottomSectionId");
    expect(appSource).toContain('bottomSectionId="resources"');
    expect(appSource).toContain("bottomSectionId={oldestReleaseId}");
  });

  test("shares the 120ms click scroll and interruption behavior across reading rails", () => {
    expect(appSource).toContain("const SECTION_SCROLL_MS = 120");
    expect(appSource).toContain("let programmaticTarget: string | undefined");
    expect(appSource).toContain("let scrollAnimationFrame: number | undefined");
    expect(appSource).toContain("const animateScrollTo = (targetY: number, sectionId: string)");
    expect(appSource).toContain("const desiredY = sectionTop - Math.min(160, window.innerHeight * 0.22)");
    expect(appSource).toContain("programmaticTarget = sectionId");
    expect(appSource).toContain("programmaticTarget = undefined");
    expect(appSource).toContain("pickActiveSection()");
    expect(appSource).toContain("easeOutCubic(progress)");
    expect(appSource).toContain("(now - startedAt) / SECTION_SCROLL_MS");
    expect(appSource).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(appSource).not.toContain("let pinnedSection");
    expect(appSource).not.toContain('target.scrollIntoView({ behavior: "smooth", block })');
    expect(appSource).toContain('window.addEventListener("wheel", releaseProgrammaticScroll, { passive: true })');
    expect(appSource).toContain('window.addEventListener("touchstart", releaseProgrammaticScroll, { passive: true })');
    expect(appSource).toContain('onClick={(event) => navigateToSection(event, item.id)}');
  });

  test("documents the shipped public interfaces", () => {
    expect(appSource).toContain("bgcut serve --json");
    expect(appSource).toContain("bgcut photo.jpg --gpu");
    expect(appSource).toContain("bgcut photo.jpg --cpu");
    expect(appSource).toContain("RemoveBackgroundResult");
    expect(appSource).toContain('import { BgcutError, removeBackground } from "bgcut"');
    expect(appSource).toContain('engine: "gpu"');
    expect(appSource).toContain('engine: "cpu"');
    expect(appSource).toContain("195,872,736 bytes");
    expect(appSource).toContain("4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c");
    expect(appSource).toContain("98,572,669 bytes");
    expect(appSource).toContain("37d4035765b97a0323729fdee787d16eb7238c39c467316e887c5292792f3e33");
    expect(appSource).toContain("The npm package does not include either model artifact");
    expect(appSource).toContain("Safari WebGPU uses FP16 only when the device exposes");
    expect(appSource).toContain("SHA-256");
  });



  test("documents the hosted-site versus packaged-local distinction", () => {
    expect(appSource).toContain("The local UI contains the bgcut brand and removal workflow only");
    expect(appSource).toContain("Docs, Changelog, GitHub");
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
    expect(appSource.match(/Last updated September 24, 2026/gu)?.length).toBe(1);
    expect(appSource.match(/Last updated September 19, 2026/gu)?.length).toBe(1);
    expect(appSource).not.toContain("The product UI is intentionally small");
    expect(appSource).not.toContain("Native surfaces");
  });

  test("keeps developer diagnostics and external comparison controls out of the product UI", () => {
    const internalComparisonName = ["B", "G", "0"].join("");

    expect(homeSource).not.toContain("diagnostics");
    expect(homeSource).not.toContain("Pipeline timing");
    expect(homeSource).not.toContain("Execution path");
    expect(homeSource).not.toContain("reference-file-input");
    expect(homeSource).not.toContain(internalComparisonName);
  });
});
