export type SitePage = "home" | "docs" | "privacy" | "terms";

export type Navigate = (page: SitePage) => void;

export const currentPage = (): SitePage => {
  const pathname = window.location.pathname.replace(/\\/+$/u, "") || "/";

  if (pathname === "/docs") {
    return "docs";
  }

  if (pathname === "/privacy") {
    return "privacy";
  }

  if (pathname === "/terms") {
    return "terms";
  }

  return "home";
};

export const pathForPage = (page: SitePage): string => {
  if (page === "docs") {
    return "/docs";
  }

  if (page === "privacy") {
    return "/privacy";
  }

  if (page === "terms") {
    return "/terms";
  }

  return "/";
};

export const shouldHandleInternalNavigation = (event: MouseEvent): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;
