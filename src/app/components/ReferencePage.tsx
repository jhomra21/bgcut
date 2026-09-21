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

type TitleTransitionPhase = "idle" | "out" | "in";

const TITLE_FADE_MS = 75;

export const ReferencePage = (props: ReferencePageProps) => {
  const [compactTitle, setCompactTitle] = createSignal(false);
  const [titlePhase, setTitlePhase] = createSignal<TitleTransitionPhase>("idle");
  let requestedCompactTitle = false;
  let titleFadeTimeout: number | undefined;

  const clearTitleFadeTimeout = () => {
    if (titleFadeTimeout === undefined) {
      return;
    }

    window.clearTimeout(titleFadeTimeout);
    titleFadeTimeout = undefined;
  };

  const startTitleFade = () => {
    if (
      titlePhase() !== "idle" ||
      requestedCompactTitle === compactTitle()
    ) {
      return;
    }

    setTitlePhase("out");

    titleFadeTimeout = window.setTimeout(() => {
      setCompactTitle(requestedCompactTitle);
      setTitlePhase("in");

      titleFadeTimeout = window.setTimeout(() => {
        titleFadeTimeout = undefined;
        setTitlePhase("idle");

        if (requestedCompactTitle !== compactTitle()) {
          startTitleFade();
        }
      }, TITLE_FADE_MS);
    }, TITLE_FADE_MS);
  };

  const fadeTitle = (compact: boolean) => {
    requestedCompactTitle = compact;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clearTitleFadeTimeout();
      setCompactTitle(compact);
      setTitlePhase("idle");

      return;
    }

    startTitleFade();
  };

  onCleanup(clearTitleFadeTimeout);

  return (
    <main class="page-content content-shell">
      <div class="content-layout">
        <SectionRail
          ariaLabel={props.railAriaLabel}
          pageTitle={props.title}
          pageTitleVisible={compactTitle()}
          pageTitlePhase={compactTitle() ? titlePhase() : "idle"}
          onPageTitleVisibilityChange={fadeTitle}
          groups={props.railGroups}
          initialSectionId={props.initialSectionId}
          sectionSelector=".reference-page > section[id]"
          bottomSectionId={props.bottomSectionId}
        />

        <article class={`content-page reference-page ${props.pageClass}`}>
          <header class="reference-page-header">
            <h1
              class="reference-page-title"
              data-title-active={compactTitle() ? "false" : "true"}
              data-title-phase={compactTitle() ? "idle" : titlePhase()}
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
