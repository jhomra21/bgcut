import { For, Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";

import { shouldHandleInternalNavigation } from "../navigation";

export type SectionRailItem = {
  readonly id: string;
  readonly label: string;
};

export type SectionRailGroup = {
  readonly label?: string;
  readonly items: readonly SectionRailItem[];
};

type SectionRailProps = {
  readonly ariaLabel: string;
  readonly groups: readonly SectionRailGroup[];
  readonly initialSectionId: string;
  readonly sectionSelector: string;
  readonly bottomSectionId?: string;
};

const SECTION_SCROLL_MS = 120;

const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

export const SectionRail = (props: SectionRailProps) => {
  const [activeSection, setActiveSection] = createSignal(props.initialSectionId);
  let programmaticTarget: string | undefined;
  let scrollAnimationFrame: number | undefined;
  let suppressBottomSectionUntil = 0;

  const hasSectionId = (sectionId: string): boolean => {
    for (const group of props.groups) {
      for (const item of group.items) {
        if (item.id === sectionId) {
          return true;
        }
      }
    }

    return false;
  };

  const sections = (): readonly HTMLElement[] => {
    const matched: HTMLElement[] = [];

    for (const section of document.querySelectorAll<HTMLElement>(props.sectionSelector)) {
      if (hasSectionId(section.id)) {
        matched.push(section);
      }
    }

    return matched;
  };

  const readingPosition = (): number => window.innerHeight * 0.52;

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
      setActiveSection(props.initialSectionId);

      return;
    }

    const matchedSections = sections();
    const marker = readingPosition();
    let nextSection = props.initialSectionId;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const section of matchedSections) {
      const rect = section.getBoundingClientRect();

      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        continue;
      }

      if (rect.top <= marker && rect.bottom >= marker) {
        nextSection = section.id;

        break;
      }

      const distance =
        marker < rect.top ? rect.top - marker : Math.max(marker - rect.bottom, 0);

      if (distance < closestDistance) {
        closestDistance = distance;
        nextSection = section.id;
      }
    }

    const bottomSectionId = props.bottomSectionId;

    if (bottomSectionId !== undefined) {
      const maxScrollY = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );

      const atDocumentBottom = Math.abs(window.scrollY - maxScrollY) <= 2;
      let bottomSectionVisible = false;

      for (const section of matchedSections) {
        if (section.id !== bottomSectionId) {
          continue;
        }

        const rect = section.getBoundingClientRect();
        bottomSectionVisible = rect.bottom > 0 && rect.top < window.innerHeight;

        break;
      }

      if (
        atDocumentBottom &&
        bottomSectionVisible &&
        performance.now() >= suppressBottomSectionUntil
      ) {
        nextSection = bottomSectionId;
      }
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

  const animateScrollTo = (targetY: number, sectionId: string) => {
    cancelScrollAnimation();
    programmaticTarget = sectionId;
    suppressBottomSectionUntil =
      sectionId === props.bottomSectionId
        ? 0
        : performance.now() + SECTION_SCROLL_MS + 120;
    setActiveSection(sectionId);

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
      const progress = Math.min((now - startedAt) / SECTION_SCROLL_MS, 1);
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

  const current = (sectionId: string): "location" | undefined =>
    activeSection() === sectionId ? "location" : undefined;

  const navigateToSection = (event: MouseEvent, sectionId: string) => {
    if (!shouldHandleInternalNavigation(event)) {
      return;
    }

    const target = document.getElementById(sectionId);

    if (target === null) {
      return;
    }

    event.preventDefault();
    window.history.replaceState(null, "", `#${sectionId}`);

    const sectionTop = window.scrollY + target.getBoundingClientRect().top;
    const desiredY = sectionTop - Math.min(160, window.innerHeight * 0.22);

    const maxScrollY = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );

    animateScrollTo(Math.min(Math.max(desiredY, 0), maxScrollY), sectionId);
  };

  return (
    <aside class="section-rail" aria-label={props.ariaLabel}>
      <For each={props.groups}>
        {(group) => (
          <div class="section-rail-group">
            <Show when={group.label}>
              {(label) => <span class="section-rail-label">{label()}</span>}
            </Show>

            <For each={group.items}>
              {(item) => (
                <a
                  href={`#${item.id}`}
                  aria-current={current(item.id)}
                  onClick={(event) => navigateToSection(event, item.id)}
                >
                  {item.label}
                </a>
              )}
            </For>
          </div>
        )}
      </For>
    </aside>
  );
};
