import { createSignal } from "solid-js";

export type SiteTheme = "light" | "dark";

const THEME_STORAGE_KEY = "bgcut-theme";

const initialTheme: SiteTheme =
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

const [theme, setTheme] = createSignal<SiteTheme>(initialTheme);

export const syncThemeColor = () => {
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  if (themeColor === null) {
    return;
  }

  const resolvedBackground = getComputedStyle(document.documentElement).backgroundColor;

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
