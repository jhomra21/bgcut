import {
  createComponent,
  generateHydrationScript,
  renderToString,
} from "@solidjs/web";

import App from "./App";
import { SITE_HYDRATION_RENDER_ID } from "../shared/hydration";
import type { SitePage } from "./navigation";

export const renderHostedApp = (page: SitePage): string =>
  renderToString(
    () => createComponent(App, { initialPage: page, runtime: "hosted" }),
    { renderId: SITE_HYDRATION_RENDER_ID },
  );

export const hydrationBootstrapSource = (): string => {
  const generated = generateHydrationScript({}).trim();
  const wrapped = /^<script(?:\s[^>]*)?>([\s\S]*)<\/script>$/u.exec(generated);

  return wrapped?.[1] ?? generated;
};
