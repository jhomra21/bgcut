import { For } from "@solidjs/web";

import {
  RESOURCE_NAV_GROUPS,
  resourceNavCurrent,
} from "../../shared/resource-navigation";
import { pathForPage, type SitePage } from "../navigation";

export const ResourceNavRail = (props: { readonly page: SitePage }) => (
  <aside class="section-rail resource-nav-rail" aria-label="Explore bgcut">
    <div class="section-rail-page-title">Explore</div>

    <For each={RESOURCE_NAV_GROUPS}>
      {(group) => (
        <div class="section-rail-group">
          <span class="section-rail-label">{group.label}</span>

          <For each={group.items}>
            {(item) => (
              <a
                href={pathForPage(item.page)}
                aria-current={resourceNavCurrent(props.page, item.page)}
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
