import { createSignal, onSettled } from "solid-js";

import { shouldHandleInternalNavigation } from "../routing";

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

export default DocsSidebar;
