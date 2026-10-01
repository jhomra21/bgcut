import {
  HydrationScript,
  createComponent,
  renderToString,
} from "@solidjs/web";

import App, { type AppProps } from "./App";
import { SITE_HYDRATION_RENDER_ID } from "../shared/hydration";
import type { SitePage } from "./navigation";

export const renderHostedApp = (page: SitePage): string => {
  const props: AppProps = { initialPage: page, runtime: "hosted" };

  return renderToString(
    () => createComponent(App, props),
    { renderId: SITE_HYDRATION_RENDER_ID },
  );
};

export const renderHydrationScript = (): string =>
  renderToString(
    () => createComponent(HydrationScript, {}),
    { renderId: SITE_HYDRATION_RENDER_ID },
  );
