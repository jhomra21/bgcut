import type { JSX } from "@solidjs/web";

import {
  SectionRail,
  type SectionRailGroup,
  type SectionRailLinkGroup,
} from "./SectionRail";

type ReferencePageProps = {
  readonly title: string;
  readonly pageClass: string;
  readonly railAriaLabel: string;
  readonly railGroups: readonly SectionRailGroup[];
  readonly initialSectionId: string;
  readonly bottomSectionId?: string;
  readonly railAfterLinks?: readonly SectionRailLinkGroup[];
  readonly children: JSX.Element;
};

export const ReferencePage = (props: ReferencePageProps) => (
  <main class="page-content content-shell">
    <div class="content-layout">
      <SectionRail
        ariaLabel={props.railAriaLabel}
        pageTitle={props.title}
        groups={props.railGroups}
        afterLinks={props.railAfterLinks}
        initialSectionId={props.initialSectionId}
        sectionSelector=".reference-page > section[id]"
        bottomSectionId={props.bottomSectionId}
      />

      <article class={`content-page reference-page ${props.pageClass}`}>
        {props.children}
      </article>
    </div>
  </main>
);
