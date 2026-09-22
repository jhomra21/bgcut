import { shouldHandleInternalNavigation, type Navigate, type SitePage } from "../navigation";
import { theme, toggleTheme } from "../theme";

const ThemeToggle = () => (
  <button
    class="theme-toggle"
    type="button"
    data-theme={theme()}
    aria-label={theme() === "dark" ? "Use light theme" : "Use dark theme"}
    title={theme() === "dark" ? "Use light theme" : "Use dark theme"}
    onClick={toggleTheme}
  >
    <svg
      class="theme-toggle-icon theme-toggle-moon"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="M15.7 14.4A6.7 6.7 0 0 1 7.1 5.8a6.7 6.7 0 1 0 8.6 8.6Z" />
    </svg>
    <svg
      class="theme-toggle-icon theme-toggle-sun"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.1v2M10 15.9v2M2.1 10h2M15.9 10h2M4.4 4.4l1.4 1.4M14.2 14.2l1.4 1.4M15.6 4.4l-1.4 1.4M5.8 14.2l-1.4 1.4" />
    </svg>
  </button>
);

export const LocalAppHeader = () => (
  <header class="app-header local-app-header">
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
    <ThemeToggle />
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

    <div class="header-controls">
      <nav class="site-nav" aria-label="Main navigation" data-active={props.page}>
        <span class="site-nav-indicator" aria-hidden="true" />
        <a
        class="site-nav-docs"
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
        class="site-nav-changelog"
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
        <a
        class="site-nav-github"
        href="https://github.com/jhomra21/bgcut"
        target="_blank"
        rel="noreferrer"
      >
        GitHub
        </a>
      </nav>
      <ThemeToggle />
    </div>
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
