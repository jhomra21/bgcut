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

const TITLE_MOVE_MS = 130;

const TITLE_MOVE_EASING = "cubic-bezier(0.2, 0, 0, 1)";

export const ReferencePage = (props: ReferencePageProps) => {
  const [compactTitle, setCompactTitle] = createSignal(false);
  let pageTitleElement: HTMLHeadingElement | undefined;
  let railTitleElement: HTMLSpanElement | undefined;
  let titleAnimation: Animation | undefined;
  let titleOverlay: HTMLSpanElement | undefined;
  let titleMoveTarget: boolean | undefined;

  const restoreTitleEndpoints = () => {
    pageTitleElement?.style.removeProperty("visibility");
    railTitleElement?.style.removeProperty("visibility");
  };

  const clearTitleMove = () => {
    if (titleAnimation !== undefined) {
      titleAnimation.onfinish = null;
      titleAnimation.cancel();
      titleAnimation = undefined;
    }

    titleOverlay?.remove();
    titleOverlay = undefined;
    titleMoveTarget = undefined;
    restoreTitleEndpoints();
  };

  const moveTitle = (compact: boolean) => {
    if (titleMoveTarget !== undefined) {
      if (titleMoveTarget === compact) {
        return;
      }

      clearTitleMove();

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
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    if (
      sourceRect.width <= 0 ||
      sourceRect.height <= 0 ||
      targetRect.width <= 0 ||
      targetRect.height <= 0
    ) {
      setCompactTitle(compact);

      return;
    }

    const sourceStyle = window.getComputedStyle(source);
    const targetStyle = window.getComputedStyle(target);
    const overlay = document.createElement("span");

    overlay.className = "reference-title-motion";
    overlay.textContent = props.title;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.left = `${sourceRect.left}px`;
    overlay.style.top = `${sourceRect.top}px`;
    overlay.style.color = sourceStyle.color;
    overlay.style.fontFamily = sourceStyle.fontFamily;
    overlay.style.fontSize = sourceStyle.fontSize;
    overlay.style.fontWeight = sourceStyle.fontWeight;
    overlay.style.letterSpacing = sourceStyle.letterSpacing;
    overlay.style.lineHeight = sourceStyle.lineHeight;

    document.body.append(overlay);

    source.style.visibility = "hidden";
    target.style.visibility = "hidden";
    titleOverlay = overlay;
    titleMoveTarget = compact;

    const animation = overlay.animate(
      [
        {
          left: `${sourceRect.left}px`,
          top: `${sourceRect.top}px`,
          fontSize: sourceStyle.fontSize,
        },
        {
          left: `${targetRect.left}px`,
          top: `${targetRect.top}px`,
          fontSize: targetStyle.fontSize,
        },
      ],
      {
        duration: TITLE_MOVE_MS,
        easing: TITLE_MOVE_EASING,
        fill: "forwards",
      },
    );

    titleAnimation = animation;

    animation.onfinish = () => {
      if (titleAnimation !== animation) {
        return;
      }

      setCompactTitle(compact);
      titleAnimation = undefined;
      titleOverlay = undefined;
      titleMoveTarget = undefined;
      restoreTitleEndpoints();
      overlay.remove();
    };
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
