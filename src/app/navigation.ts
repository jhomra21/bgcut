import {
  PUBLIC_SITE_PAGES,
  SITE_PAGE_METADATA,
  type PublicSitePage,
} from "../shared/site-metadata";

export type SitePage = PublicSitePage;

const LOCAL_RUNTIME_META_SELECTOR = 'meta[name="bgcut-runtime"][content="local"]';

const PAGE_BY_PATH = new Map(
  PUBLIC_SITE_PAGES.map((page) => [SITE_PAGE_METADATA[page].path, page]),
);

export const isLocalRuntime = (): boolean =>
  import.meta.env.DEV ||
  document.querySelector(LOCAL_RUNTIME_META_SELECTOR) !== null;

export type Navigate = (page: SitePage) => void;

export type RouteTransitionPhase = "idle" | "out" | "in";

export type HistoryMode = "push" | "none";

export const ROUTE_FADE_MS = 75;

export const currentPage = (): SitePage => {
  const pathname = window.location.pathname.replace(/\/+$/u, "") || "/";

  return PAGE_BY_PATH.get(pathname) ?? "home";
};

export const pathForPage = (page: SitePage): string =>
  SITE_PAGE_METADATA[page].path;

export const shouldHandleInternalNavigation = (event: MouseEvent): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;
