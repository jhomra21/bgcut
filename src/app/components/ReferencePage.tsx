import type { JSX } from "@solidjs/web";
import { createSignal, onCleanup } from "solid-js";

import {
  SectionRail,
  type SectionRailGroup,
} from "./SectionRail";

type ReferencePageProps = {
  readonly title: string;
  readonly pageClass: string;
  readonly railAriaLabel: string;
  readonly railGroups: readonly SectionRailGroup[];
  readonly initialSectionId: string;
  readonly bottomSectionId?: string;
  readonly children: JSX.Element;
};

type TitleFrame = {
  readonly left: number;
  readonly top: number;
  readonly fontSize: number;
};

const TITLE_MOVE_MS = 130;

const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

const interpolate = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress;

const readTitleFrame = (element: HTMLElement): TitleFrame => {
  const rect = element.getBoundingClientRect();
  const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);

  return {
    left: rect.left,
    top: rect.top,
    fontSize: Number.isFinite(fontSize) ? fontSize : rect.height,
  };
};

export const ReferencePage = (props: ReferencePageProps) => {
  const [compactTitle, setCompactTitle] = createSignal(false);
  let pageTitleElement: HTMLHeadingElement | undefined;
  let railTitleElement: HTMLSpanElement | undefined;
  let titleAnimationFrame: number | undefined;
  let titleOverlay: HTMLSpanElement | undefined;
  let titleMoveTarget: boolean | undefined;
  let titleMoveSource: TitleFrame | undefined;
  let titleMoveCurrent: TitleFrame | undefined;
  let titleMoveStartedAt = 0;

  const restoreTitleEndpoints = () => {
    pageTitleElement?.style.removeProperty("visibility");
    railTitleElement?.style.removeProperty("visibility");
  };

  const clearTitleMove = () => {
    if (titleAnimationFrame !== undefined) {
      window.cancelAnimationFrame(titleAnimationFrame);
      titleAnimationFrame = undefined;
    }

    titleOverlay?.remove();
    titleOverlay = undefined;
    titleMoveTarget = undefined;
    titleMoveSource = undefined;
    titleMoveCurrent = undefined;
    restoreTitleEndpoints();
  };

  const finishTitleMove = (compact: boolean) => {
    setCompactTitle(compact);
    titleAnimationFrame = undefined;
    titleMoveTarget = undefined;
    titleMoveSource = undefined;
    titleMoveCurrent = undefined;
    restoreTitleEndpoints();
    titleOverlay?.remove();
    titleOverlay = undefined;
  };

  const tickTitleMove = (now: number) => {
    const overlay = titleOverlay;
    const source = titleMoveSource;
    const compact = titleMoveTarget;
    const target = compact ? railTitleElement : pageTitleElement;

    if (
      overlay === undefined ||
      source === undefined ||
      compact === undefined ||
      target === undefined
    ) {
      clearTitleMove();

      return;
    }

    const targetFrame = readTitleFrame(target);
    const progress = Math.min((now - titleMoveStartedAt) / TITLE_MOVE_MS, 1);
    const eased = easeOutCubic(progress);

    const current = {
      left: interpolate(source.left, targetFrame.left, eased),
      top: interpolate(source.top, targetFrame.top, eased),
      fontSize: interpolate(source.fontSize, targetFrame.fontSize, eased),
    };

    overlay.style.left = `${current.left}px`;
    overlay.style.top = `${current.top}px`;
    overlay.style.fontSize = `${current.fontSize}px`;
    titleMoveCurrent = current;

    if (progress < 1) {
      titleAnimationFrame = window.requestAnimationFrame(tickTitleMove);

      return;
    }

    finishTitleMove(compact);
  };

  const retargetTitleMove = (compact: boolean) => {
    if (titleMoveTarget === compact) {
      return;
    }

    const current = titleMoveCurrent;

    if (current === undefined) {
      clearTitleMove();

      return;
    }

    titleMoveTarget = compact;
    titleMoveSource = current;
    titleMoveStartedAt = performance.now();
  };

  const moveTitle = (compact: boolean) => {
    if (titleMoveTarget !== undefined) {
      retargetTitleMove(compact);

      return;
    }

    if (compactTitle() === compact) {
      return;
    }

    const pageTitle = pageTitleElement;
    const railTitle = railTitleElement;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion || pageTitle === undefined || railTitle === undefined) {
      setCompactTitle(compact);

      return;
    }

    const source = compactTitle() ? railTitle : pageTitle;
    const target = compact ? railTitle : pageTitle;
    const sourceFrame = readTitleFrame(source);
    const targetFrame = readTitleFrame(target);

    if (
      sourceFrame.fontSize <= 0 ||
      targetFrame.fontSize <= 0 ||
      source.getBoundingClientRect().width <= 0 ||
      target.getBoundingClientRect().width <= 0
    ) {
      setCompactTitle(compact);

      return;
    }

    const sourceStyle = window.getComputedStyle(source);
    const overlay = document.createElement("span");

    overlay.className = "reference-title-motion";
    overlay.textContent = props.title;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.left = `${sourceFrame.left}px`;
    overlay.style.top = `${sourceFrame.top}px`;
    overlay.style.color = sourceStyle.color;
    overlay.style.fontFamily = sourceStyle.fontFamily;
    overlay.style.fontSize = `${sourceFrame.fontSize}px`;
    overlay.style.fontWeight = sourceStyle.fontWeight;
    overlay.style.letterSpacing = sourceStyle.letterSpacing;
    overlay.style.lineHeight = sourceStyle.lineHeight;

    document.body.append(overlay);

    source.style.visibility = "hidden";
    target.style.visibility = "hidden";
    titleOverlay = overlay;
    titleMoveTarget = compact;
    titleMoveSource = sourceFrame;
    titleMoveCurrent = sourceFrame;
    titleMoveStartedAt = performance.now();
    titleAnimationFrame = window.requestAnimationFrame(tickTitleMove);
  };

  onCleanup(clearTitleMove);

  return (
    <main class="page-content content-shell">
      <div class="content-layout">
        <SectionRail
          ariaLabel={props.railAriaLabel}
          pageTitle={props.title}
          pageTitleVisible={compactTitle()}
          onPageTitleVisibilityChange={moveTitle}
          onPageTitleElement={(element) => {
            railTitleElement = element;
          }}
          groups={props.railGroups}
          initialSectionId={props.initialSectionId}
          sectionSelector=".reference-page > section[id]"
          bottomSectionId={props.bottomSectionId}
        />

        <article class={`content-page reference-page ${props.pageClass}`}>
          <header class="reference-page-header">
            <h1
              ref={(element) => {
                pageTitleElement = element;
              }}
              class="reference-page-title"
              data-title-active={compactTitle() ? "false" : "true"}
              aria-hidden={compactTitle() ? "true" : undefined}
            >
              {props.title}
            </h1>
          </header>

          {props.children}
        </article>
      </div>
    </main>
  );
};
