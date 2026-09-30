import type { JSX } from "@solidjs/web";

import type { SitePage } from "../navigation";
import { ResourceNavRail } from "./ResourceNavRail";

export const ResourcePage = (props: {
  readonly page: SitePage;
  readonly pageClass: string;
  readonly children: JSX.Element;
}) => (
  <main class="page-content content-shell">
    <div class="content-layout">
      <ResourceNavRail page={props.page} />

      <article class={`guide-page resource-content-page ${props.pageClass}`}>
        {props.children}
      </article>
    </div>
  </main>
);
