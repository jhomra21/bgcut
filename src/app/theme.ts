import { createSignal } from "solid-js";
import { isServer } from "@solidjs/web";

export type SiteTheme = "light" | "dark";

const THEME_STORAGE_KEY = "bgcut-theme";

const storedTheme = (): SiteTheme | undefined => {
  if (isServer) {
    return undefined;
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    return stored === "light" || stored === "dark" ? stored : undefined;
  } catch {
    return undefined;
  }
};

const initialTheme: SiteTheme =
  storedTheme() ??
  (!isServer && document.documentElement.dataset.theme === "dark" ? "dark" : "light");

if (!isServer) {
  document.documentElement.dataset.theme = initialTheme;
}

const [theme, setTheme] = createSignal<SiteTheme>(initialTheme);

export const syncThemeColor = () => {
  if (isServer) {
    return;
  }

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  if (themeColor === null) {
    return;
  }

  const resolvedBackground = getComputedStyle(document.documentElement)
    .getPropertyValue("--background-primary")
    .trim();

  themeColor.setAttribute("content", resolvedBackground);
};

export const toggleTheme = () => {
  const nextTheme: SiteTheme = theme() === "dark" ? "light" : "dark";

  document.documentElement.dataset.theme = nextTheme;
  syncThemeColor();

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Theme selection still applies for this page when storage is unavailable.
  }

  setTheme(nextTheme);
};

export { theme };
