import { createSignal } from "solid-js";

export type SiteTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "bgcut-theme";

const LIGHT_THEME_COLOR = "#fbfbfa";
const DARK_THEME_COLOR = "#11110f";

const initialTheme: SiteTheme =
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

const [theme, setTheme] = createSignal<SiteTheme>(initialTheme);

const applyThemeColor = (nextTheme: SiteTheme) => {
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  themeColor?.setAttribute(
    "content",
    nextTheme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
  );
};

export const toggleTheme = () => {
  const nextTheme: SiteTheme = theme() === "dark" ? "light" : "dark";

  document.documentElement.dataset.theme = nextTheme;
  applyThemeColor(nextTheme);

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Theme selection still applies for this page when storage is unavailable.
  }

  setTheme(nextTheme);
};

export { theme };
