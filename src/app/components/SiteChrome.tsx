import { shouldHandleInternalNavigation, type Navigate, type SitePage } from "../navigation";

export const LocalAppHeader = () => (
  <header class="app-header">
    <div class="brand-link">
      <h1 class="brand-title">
        <img
          class="brand-mark"
          src="/favicon-48x48.png?v=2"
          alt=""
          width="32"
          height="32"
          aria-hidden="true"
        />
        <span>bgcut</span>
      </h1>
    </div>
  </header>
);

export const SiteHeader = (props: { readonly page: SitePage; readonly onNavigate: Navigate }) => (
  <header class="app-header">
    <a
      class="brand-link"
      href="/"
      aria-label="bgcut home"
      onClick={(event) => {
        if (!shouldHandleInternalNavigation(event)) {
          return;
        }

        event.preventDefault();
        props.onNavigate("home");
      }}
    >
      <div class="brand-title">
        <img
          class="brand-mark"
          src="/favicon-48x48.png?v=2"
          alt=""
          width="32"
          height="32"
          aria-hidden="true"
        />
        <span>bgcut</span>
      </div>
    </a>

    <nav class="site-nav" aria-label="Main navigation">
      <a
        href="/docs"
        aria-current={props.page === "docs" ? "page" : undefined}
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("docs");
        }}
      >
        Docs
      </a>
      <a
        href="/changelog"
        aria-current={props.page === "changelog" ? "page" : undefined}
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("changelog");
        }}
      >
        Changelog
      </a>
      <a href="https://github.com/jhomra21/bgcut" target="_blank" rel="noreferrer">
        GitHub
      </a>
    </nav>
  </header>
);

export const SiteFooter = (props: { readonly onNavigate: Navigate }) => (
  <footer class="site-footer">
    <div class="site-footer-meta">
      <a
        class="site-footer-brand brand-link"
        href="/"
        aria-label="bgcut home"
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("home");
        }}
      >
        <img
          class="brand-mark"
          src="/favicon-48x48.png?v=2"
          alt=""
          width="22"
          height="22"
          aria-hidden="true"
        />
        <span>bgcut</span>
      </a>
      <span>MIT licensed</span>
    </div>
    <nav class="site-footer-links" aria-label="Footer navigation">
      <a
        href="/changelog"
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("changelog");
        }}
      >
        Changelog
      </a>
      <a
        href="/privacy"
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("privacy");
        }}
      >
        Privacy
      </a>
      <a
        href="/terms"
        onClick={(event) => {
          if (!shouldHandleInternalNavigation(event)) {
            return;
          }

          event.preventDefault();
          props.onNavigate("terms");
        }}
      >
        Terms
      </a>
    </nav>
  </footer>
);
