import { Match, Switch, createSignal, onSettled } from "solid-js";
import { isServer } from "@solidjs/web";

import { isComparisonPage } from "../shared/comparisons";
import { isGuidePage } from "../shared/guides";
import { isIntentPage } from "../shared/intent-pages";
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
import { ComparisonIndexPage, ComparisonPage } from "./pages/ComparisonPage";
import { DocsPage } from "./pages/DocsPage";
import { GuideIndexPage, GuidePage } from "./pages/GuidePage";
import { HomePage } from "./pages/HomePage";
import { IntentPageView } from "./pages/IntentPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { applySiteMetadata } from "./site-metadata";
import { TermsPage } from "./pages/TermsPage";
import { ToolIndexPage, TransparencyCheckerPage } from "./pages/ToolPage";

const PageContent = (props: { readonly page: SitePage }) => {
  const intentPage = () => isIntentPage(props.page) ? props.page : undefined;
  const guidePage = () => isGuidePage(props.page) ? props.page : undefined;
  const comparisonPage = () => isComparisonPage(props.page) ? props.page : undefined;

  return (
    <Switch fallback={<HomePage showIntro />}>
      <Match when={props.page === "docs"}>
        <DocsPage />
      </Match>
      <Match when={props.page === "changelog"}>
        <ChangelogPage />
      </Match>
      <Match keyed when={intentPage()}>
        {(page) => <IntentPageView page={page} />}
      </Match>
      <Match when={props.page === "guides"}>
        <GuideIndexPage />
      </Match>
      <Match keyed when={guidePage()}>
        {(page) => <GuidePage page={page} />}
      </Match>
      <Match when={props.page === "compare"}>
        <ComparisonIndexPage />
      </Match>
      <Match keyed when={comparisonPage()}>
        {(page) => <ComparisonPage page={page} />}
      </Match>
      <Match when={props.page === "tools"}>
        <ToolIndexPage />
      </Match>
      <Match when={props.page === "tool-transparency-checker"}>
        <TransparencyCheckerPage />
      </Match>
      <Match when={props.page === "privacy"}>
        <PrivacyPage />
      </Match>
      <Match when={props.page === "terms"}>
        <TermsPage />
      </Match>
    </Switch>
  );
};

export type AppRuntime = "hosted" | "local";

export type AppProps = {
  readonly initialPage?: SitePage;
  readonly runtime?: AppRuntime;
};

const App = (props: AppProps = {}) => {
  const localRuntime =
    props.runtime === "local" ||
    (props.runtime === undefined && !isServer && isLocalRuntime());

  if (localRuntime) {
    return (
      <div class="site-root local-app-root">
        <div class="site-header-shell">
          <LocalAppHeader />
        </div>
        <HomePage />
      </div>
    );
  }

  const initialPage = props.initialPage ?? currentPage();

  const [page, setPage] = createSignal<SitePage>(initialPage);
  const [navPage, setNavPage] = createSignal<SitePage>(initialPage);
  const [routePhase, setRoutePhase] = createSignal<RouteTransitionPhase>("idle");

  if (!isServer) {
    applySiteMetadata(initialPage);
  }

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
      <div class="site-header-shell site-header-shell-floating">
        <SiteHeader page={navPage()} onNavigate={navigate} />
      </div>

      <div class={`route-stage route-stage-${routePhase()}`}>
        <PageContent page={page()} />
      </div>

      <div class="site-footer-shell">
        <SiteFooter page={navPage()} onNavigate={navigate} />
      </div>
    </div>
  );
};

export default App;
