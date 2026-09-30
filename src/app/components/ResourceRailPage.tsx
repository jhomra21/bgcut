import type { JSX } from "@solidjs/web";

import {
  SectionRail,
  type SectionRailGroup,
  type SectionRailLinkGroup,
} from "./SectionRail";

type ResourceRailPageProps = {
  readonly areaTitle: string;
  readonly allHref: string;
  readonly allLabel: string;
  readonly railAriaLabel: string;
  readonly groups: readonly SectionRailGroup[];
  readonly initialSectionId: string;
  readonly sectionSelector: string;
  readonly bottomSectionId?: string;
  readonly exploreLinks: readonly SectionRailLinkGroup[];
  readonly pageClass: string;
  readonly children: JSX.Element;
};

export const ResourceRailPage = (props: ResourceRailPageProps) => (
  <main class="page-content content-shell">
    <div class="content-layout">
      <SectionRail
        ariaLabel={props.railAriaLabel}
        pageTitle={props.areaTitle}
        pageTitleElement="div"
        beforeLinks={[
          {
            items: [{ href: props.allHref, label: `← ${props.allLabel}` }],
          },
        ]}
        groups={props.groups}
        afterLinks={props.exploreLinks}
        initialSectionId={props.initialSectionId}
        sectionSelector={props.sectionSelector}
        bottomSectionId={props.bottomSectionId}
      />

      <article class={`guide-page resource-content-page ${props.pageClass}`}>
        {props.children}
      </article>
    </div>
  </main>
);
