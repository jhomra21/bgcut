import {
  canonicalUrlForPage,
  SITE_PAGE_METADATA,
  structuredDataForPage,
  type PublicSitePage,
} from "../shared/site-metadata";

const setMetaContent = (selector: string, value: string): void => {
  const element = document.querySelector<HTMLMetaElement>(selector);

  if (element !== null) {
    element.content = value;
  }
};

export const applySiteMetadata = (page: PublicSitePage): void => {
  const metadata = SITE_PAGE_METADATA[page];
  const canonicalUrl = canonicalUrlForPage(page);

  document.title = metadata.title;

  setMetaContent('meta[name="description"]', metadata.description);
  setMetaContent(
    'meta[name="robots"]',
    metadata.index
      ? "index, follow, max-image-preview:large"
      : "noindex, follow, max-image-preview:large",
  );
  setMetaContent('meta[property="og:title"]', metadata.title);
  setMetaContent('meta[property="og:description"]', metadata.description);
  setMetaContent('meta[property="og:url"]', canonicalUrl);
  setMetaContent('meta[name="twitter:title"]', metadata.title);
  setMetaContent('meta[name="twitter:description"]', metadata.description);

  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');

  if (canonical !== null) {
    canonical.href = canonicalUrl;
  }

  const structuredData = document.querySelector<HTMLScriptElement>("#site-structured-data");

  if (structuredData !== null) {
    structuredData.textContent = JSON.stringify(structuredDataForPage(page));
  }
};
