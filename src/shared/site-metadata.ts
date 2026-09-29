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
    title: "Free Background Remover - Private, Local, No Uploads | bgcut",
    description:
      "Remove image backgrounds free in your browser. Images stay on your device, with WebGPU when available. No signup, credits, or image uploads to bgcut.",
    index: true,
  },
  docs: {
    path: "/docs",
    title: "bgcut Docs - Browser, CLI and Node.js Background Removal",
    description:
      "Use bgcut in the browser, from the command line, or from Node.js. Learn local background removal, batch processing, engines, formats, and runtime behavior.",
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

export const PUBLIC_SITE_PAGES = [
  "home",
  "docs",
  "changelog",
  "privacy",
  "terms",
] as const satisfies readonly PublicSitePage[];

export const INDEXED_SITE_PAGES = PUBLIC_SITE_PAGES.filter(
  (page) => SITE_PAGE_METADATA[page].index,
);

export const canonicalUrlForPage = (page: PublicSitePage): string =>
  new URL(SITE_PAGE_METADATA[page].path, SITE_ORIGIN).href;

const breadcrumbStructuredDataForPage = (page: PublicSitePage) => {
  const metadata = SITE_PAGE_METADATA[page];
  const url = canonicalUrlForPage(page);

  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "bgcut",
        item: `${SITE_ORIGIN}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: metadata.title,
        item: url,
      },
    ],
  };
};

export const structuredDataForPage = (page: PublicSitePage) => {
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
          sameAs: [
            "https://github.com/jhomra21/bgcut",
            "https://www.npmjs.com/package/bgcut",
          ],
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
          softwareHelp: `${SITE_ORIGIN}/docs`,
          sameAs: [
            "https://github.com/jhomra21/bgcut",
            "https://www.npmjs.com/package/bgcut",
          ],
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
    "@graph": [
      {
        "@type": page === "changelog" ? "CollectionPage" : "WebPage",
        "@id": `${url}#page`,
        name: metadata.title,
        url,
        description: metadata.description,
        isPartOf: {
          "@id": `${SITE_ORIGIN}/#website`,
        },
      },
      breadcrumbStructuredDataForPage(page),
    ],
  };
};
