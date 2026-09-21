export type PublicSitePage =
  | "home"
  | "docs"
  | "changelog"
  | "privacy"
  | "terms";

export type SitePageMetadata = {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly index: boolean;
};

export const SITE_ORIGIN = "https://bgcut.dev";

export const SITE_PAGE_METADATA: Readonly<Record<PublicSitePage, SitePageMetadata>> = {
  home: {
    path: "/",
    title: "Free Background Remover - Private & Local | bgcut",
    description:
      "Remove image backgrounds free in your browser. bgcut runs locally with WebGPU when available, supports PNG, JPEG, WebP and AVIF, and does not upload your images.",
    index: true,
  },
  docs: {
    path: "/docs",
    title: "bgcut Docs - Browser, CLI and Node.js Background Removal",
    description:
      "Use bgcut as a browser background remover, local CLI, or Node.js background removal API with WebGPU and CPU support.",
    index: true,
  },
  changelog: {
    path: "/changelog",
    title: "bgcut Changelog - Releases and API Changes",
    description:
      "Release notes for bgcut, including browser, CLI, Node.js API, performance, packaging, and background-removal changes.",
    index: true,
  },
  privacy: {
    path: "/privacy",
    title: "Privacy | bgcut",
    description:
      "How bgcut processes images locally and what network requests the hosted site, CLI, local app, and Node.js API make.",
    index: false,
  },
  terms: {
    path: "/terms",
    title: "Terms of Use | bgcut",
    description:
      "Terms covering bgcut.dev, the bgcut software, third-party dependencies, and use of generated background-removal output.",
    index: false,
  },
};

export const canonicalUrlForPage = (page: PublicSitePage): string =>
  new URL(SITE_PAGE_METADATA[page].path, SITE_ORIGIN).href;

export const structuredDataForPage = (page: PublicSitePage): unknown => {
  const metadata = SITE_PAGE_METADATA[page];
  const url = canonicalUrlForPage(page);

  if (page === "home") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "@id": `${SITE_ORIGIN}/#website`,
          name: "bgcut",
          url: `${SITE_ORIGIN}/`,
          description: metadata.description,
        },
        {
          "@type": "WebApplication",
          "@id": `${SITE_ORIGIN}/#app`,
          name: "bgcut",
          url,
          description: metadata.description,
          applicationCategory: "DesignApplication",
          operatingSystem: "Any",
          image: `${SITE_ORIGIN}/og-image.png`,
          isAccessibleForFree: true,
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
          },
        },
      ],
    };
  }

  return {
    "@context": "https://schema.org",
    "@type": page === "changelog" ? "CollectionPage" : "WebPage",
    name: metadata.title,
    url,
    description: metadata.description,
    isPartOf: {
      "@id": `${SITE_ORIGIN}/#website`,
    },
  };
};
