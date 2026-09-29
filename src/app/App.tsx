import { createSignal, onSettled } from "solid-js";

import { isGuidePage } from "../shared/guides";
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
import { DocsPage } from "./pages/DocsPage";
import { GuideIndexPage, GuidePage } from "./pages/GuidePage";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { applySiteMetadata } from "./site-metadata";
import { TermsPage } from "./pages/TermsPage";

const isReferencePage = (page: SitePage): boolean =>
  page === "docs" || page === "changelog";

const PageContent = (props: { readonly page: SitePage }) => {
  if (props.page === "docs") {
    return <DocsPage />;
  }

  if (props.page === "changelog") {
    return <ChangelogPage />;
  }

  if (props.page === "guides") {
    return <GuideIndexPage />;
  }

  if (isGuidePage(props.page)) {
    return <GuidePage page={props.page} />;
  }

  if (props.page === "privacy") {
    return <PrivacyPage />;
  }

  if (props.page === "terms") {
    return <TermsPage />;
  }

  return <HomePage showIntro />;
};

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
      <div class={`site-header-shell ${isReferencePage(navPage()) ? "site-header-shell-sticky" : ""}`}>
        <SiteHeader page={navPage()} onNavigate={navigate} />
      </div>

      <div class={`route-stage route-stage-${routePhase()}`}>
        <PageContent page={page()} />
      </div>

      <div class="site-footer-shell">
        <SiteFooter onNavigate={navigate} />
      </div>
    </div>
  );
};

export default App;
