import { hydrate, render } from "@solidjs/web";

import App from "./App";
import "./styles.css";
import { SITE_HYDRATION_RENDER_ID } from "../shared/hydration";
import { syncThemeColor } from "./theme";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Missing #root element.");
}

syncThemeColor();

if (root.dataset.bgcutHydrate === SITE_HYDRATION_RENDER_ID) {
  hydrate(() => <App />, root, { renderId: SITE_HYDRATION_RENDER_ID });
} else {
  render(() => <App />, root);
}
