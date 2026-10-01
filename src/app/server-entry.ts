import {
  createComponent,
  generateHydrationScript,
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

export const hydrationBootstrapSource = (): string => {
  const generated = generateHydrationScript({}).trim();
  const openingTagEnd = generated.indexOf(">");
  const closingTagStart = generated.lastIndexOf("</script>");

  if (
    !generated.startsWith("<script") ||
    openingTagEnd === -1 ||
    closingTagStart <= openingTagEnd
  ) {
    throw new Error("Solid hydration bootstrap did not contain a script wrapper.");
  }

  const trailingMarkup = generated
    .slice(closingTagStart + "</script>".length)
    .trim();

  if (trailingMarkup !== "" && trailingMarkup !== "<!--xs-->") {
    throw new Error(
      `Solid hydration bootstrap had unexpected trailing markup: ${trailingMarkup}`,
    );
  }

  return generated.slice(openingTagEnd + 1, closingTagStart).trim();
};
