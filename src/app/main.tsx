import { render } from "@solidjs/web";

import App from "./App";
import "./styles.css";
import { syncThemeColor } from "./theme";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Missing #root element.");
}

syncThemeColor();

render(() => <App />, root);
