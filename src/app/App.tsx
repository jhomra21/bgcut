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
import { DocsPage } from "./pages/DocsPage";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";

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
  const [routePhase, setRoutePhase] = createSignal<RouteTransitionPhase>("idle");
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
      window.scrollTo(0, 0);
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

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      transitionVersion += 1;
      clearRouteTransition();
    };
  });

  return (
    <div class="site-root">
      <div class="site-header-shell">
        <SiteHeader page={page()} onNavigate={navigate} />
      </div>

      <div class={`route-stage route-stage-${routePhase()}`}>
        <Show
          when={page() === "docs"}
          fallback={
            <Show
              when={page() === "privacy"}
              fallback={
                <Show when={page() === "terms"} fallback={<HomePage />}>
                  <TermsPage />
                </Show>
              }
            >
              <PrivacyPage />
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
