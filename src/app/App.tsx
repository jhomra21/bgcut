import { Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";

import { LocalAppHeader, SiteFooter, SiteHeader } from "./components/SiteChrome";
import {
  currentPage,
  isLocalRuntime,
  pathForPage,
  ROUTE_FADE_MS,
  type HistoryMode,
  type Navigate,
  type RouteTransitionPhase,
  type SitePage,
} from "./navigation";
import { ChangelogPage } from "./pages/ChangelogPage";
import { applySiteMetadata } from "./site-metadata";
import { DocsPage } from "./pages/DocsPage";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";

const isReferencePage = (page: SitePage): boolean =>
  page === "docs" || page === "changelog";

const App = () => {
  if (isLocalRuntime()) {
    return (
      <div class="site-root local-app-root">
        <div class="site-header-shell">
          <LocalAppHeader />
        </div>
        <HomePage />
      </div>
    );
  }

  const initialPage = currentPage();
  const [page, setPage] = createSignal<SitePage>(initialPage);
  const [navPage, setNavPage] = createSignal<SitePage>(initialPage);
  const [routePhase, setRoutePhase] = createSignal<RouteTransitionPhase>("idle");
  const [headerScrolled, setHeaderScrolled] = createSignal(false);

  applySiteMetadata(initialPage);
  let routeTarget = initialPage;
  let transitionTimer: number | undefined;
  let transitionVersion = 0;

  const clearRouteTransition = () => {
    if (transitionTimer !== undefined) {
      window.clearTimeout(transitionTimer);
      transitionTimer = undefined;
    }
  };

  const transitionTo = (nextPage: SitePage, historyMode: HistoryMode) => {
    if (nextPage === routeTarget && routePhase() !== "idle") {
      return;
    }

    if (nextPage === page() && routePhase() === "idle") {
      return;
    }

    routeTarget = nextPage;
    setNavPage(nextPage);
    clearRouteTransition();
    transitionVersion += 1;
    const version = transitionVersion;

    if (nextPage === page()) {
      setRoutePhase("idle");

      return;
    }

    setRoutePhase("out");

    transitionTimer = window.setTimeout(() => {
      if (version !== transitionVersion) {
        return;
      }

      transitionTimer = undefined;

      if (historyMode === "push") {
        window.history.pushState(null, "", pathForPage(nextPage));
      }

      setPage(nextPage);
      applySiteMetadata(nextPage);
      window.scrollTo(0, 0);
      setHeaderScrolled(false);
      setRoutePhase("in");

      transitionTimer = window.setTimeout(() => {
        if (version !== transitionVersion) {
          return;
        }

        transitionTimer = undefined;
        setRoutePhase("idle");
      }, ROUTE_FADE_MS);
    }, ROUTE_FADE_MS);
  };

  const navigate: Navigate = (nextPage) => transitionTo(nextPage, "push");

  onSettled(() => {
    const handlePopState = () => {
      transitionTo(currentPage(), "none");
    };

    const handleScroll = () => {
      setHeaderScrolled(window.scrollY > 96);
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("scroll", handleScroll);
      transitionVersion += 1;
      clearRouteTransition();
    };
  });

  return (
    <div class="site-root">
      <div
        class={`site-header-shell ${isReferencePage(navPage()) ? "site-header-shell-sticky" : ""}`}
        data-scrolled={isReferencePage(navPage()) && headerScrolled() ? "true" : "false"}
      >
        <SiteHeader
          page={navPage()}
          onNavigate={navigate}
          showPageContext={isReferencePage(navPage()) && headerScrolled()}
        />
      </div>

      <div class={`route-stage route-stage-${routePhase()}`}>
        <Show
          when={page() === "docs"}
          fallback={
            <Show
              when={page() === "changelog"}
              fallback={
                <Show
                  when={page() === "privacy"}
                  fallback={
                    <Show when={page() === "terms"} fallback={<HomePage showIntro />}>
                      <TermsPage />
                    </Show>
                  }
                >
                  <PrivacyPage />
                </Show>
              }
            >
              <ChangelogPage />
            </Show>
          }
        >
          <DocsPage />
        </Show>
      </div>

      <div class="site-footer-shell">
        <SiteFooter onNavigate={navigate} />
      </div>
    </div>
  );
};

export default App;
