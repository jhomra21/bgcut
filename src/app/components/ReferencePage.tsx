import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

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

type ViewTransitionHandle = {
  readonly finished: Promise<void>;
  skipTransition(): void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionHandle;
};

export const ReferencePage = (props: ReferencePageProps) => {
  const [compactTitle, setCompactTitle] = createSignal(false);
  let activeTitleTransition: ViewTransitionHandle | undefined;

  const moveTitle = (compact: boolean) => {
    if (compactTitle() === compact) {
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const transitionDocument = document as ViewTransitionDocument;
    const startViewTransition = transitionDocument.startViewTransition;

    if (reducedMotion || startViewTransition === undefined) {
      setCompactTitle(compact);

      return;
    }

    activeTitleTransition?.skipTransition();

    const transition = startViewTransition.call(transitionDocument, () => {
      setCompactTitle(compact);
    });

    activeTitleTransition = transition;

    void transition.finished.finally(() => {
      if (activeTitleTransition === transition) {
        activeTitleTransition = undefined;
      }
    });
  };

  return (
    <main class="page-content content-shell">
      <div class="content-layout">
        <SectionRail
          ariaLabel={props.railAriaLabel}
          pageTitle={props.title}
          pageTitleVisible={compactTitle()}
          onPageTitleVisibilityChange={moveTitle}
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
