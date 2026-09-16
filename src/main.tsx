import { render } from "@solidjs/web";

import App from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Missing #root element.");
}

render(() => <App />, root);
