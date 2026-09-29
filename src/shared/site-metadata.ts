import {
  COMPARISONS,
  COMPARISON_PAGE_IDS,
  isComparisonPage,
  pathForComparison,
  type ComparisonPageId,
} from "./comparisons";
import { SITE_TOOLS, TOOL_PAGE_IDS, isToolPage, type ToolPageId } from "./tools";
import {
  GUIDES,
  GUIDE_PAGE_IDS,
  isGuidePage,
  type GuidePageId,
} from "./guides";

export type CoreSitePage =
  | "home"
  | "docs"
  | "changelog"
  | "guides"
  | "compare"
  | "tools"
  | "privacy"
  | "terms";

export type PublicSitePage = CoreSitePage | GuidePageId | ComparisonPageId | ToolPageId;

export type SitePageMetadata = {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly index: boolean;
};

export const SITE_ORIGIN = "https://bgcut.dev";

// SAFETY: GUIDE_PAGE_IDS lists every GuidePageId, and each tuple uses the same page key.
const GUIDE_SITE_METADATA = Object.fromEntries(
  GUIDE_PAGE_IDS.map((page) => {
    const guide = GUIDES[page];

    return [
      page,
      {
        path: `/guides/${guide.slug}`,
        title: `${guide.title} | bgcut`,
        description: guide.description,
        index: true,
      },
    ];
  }),
) as Record<GuidePageId, SitePageMetadata>;

// SAFETY: COMPARISON_PAGE_IDS lists every ComparisonPageId, and each tuple uses the same page key.
const COMPARISON_SITE_METADATA = Object.fromEntries(
  COMPARISON_PAGE_IDS.map((page) => {
    const comparison = COMPARISONS[page];

    return [
      page,
      {
        path: pathForComparison(comparison),
        title: `${comparison.title} | bgcut`,
        description: comparison.description,
        index: true,
      },
    ];
  }),
) as Record<ComparisonPageId, SitePageMetadata>;

// SAFETY: TOOL_PAGE_IDS lists every ToolPageId, and each tuple uses the same page key.
const TOOL_SITE_METADATA = Object.fromEntries(
  TOOL_PAGE_IDS.map((page) => {
    const tool = SITE_TOOLS[page];

    return [
      page,
      {
        path: `/tools/${tool.slug}`,
        title: `${tool.title} - Free, Local Image Tool | bgcut`,
        description: tool.description,
        index: true,
      },
    ];
  }),
) as Record<ToolPageId, SitePageMetadata>;

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
  guides: {
    path: "/guides",
    title: "Background Removal Guides - Local, Browser, CLI and Node.js | bgcut",
    description:
      "Practical guides to local background removal with browser WebGPU and WebAssembly, Node.js, CLI batches, image formats, and privacy checks.",
    index: true,
  },
  compare: {
    path: "/compare",
    title: "Background Remover Alternatives and Comparisons | bgcut",
    description:
      "Compare bgcut with remove.bg, BG0, IMG.LY background removal, and rembg by deployment model, interfaces, privacy, and licensing.",
    index: true,
  },
  tools: {
    path: "/tools",
    title: "Free Local Image Tools | bgcut",
    description:
      "Free browser image utilities from bgcut. Check transparency locally without uploading the source image.",
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
  ...GUIDE_SITE_METADATA,
  ...COMPARISON_SITE_METADATA,
  ...TOOL_SITE_METADATA,
};

export const PUBLIC_SITE_PAGES = [
  "home",
  "docs",
  "changelog",
  "guides",
  ...GUIDE_PAGE_IDS,
  "compare",
  ...COMPARISON_PAGE_IDS,
  "tools",
  ...TOOL_PAGE_IDS,
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

  const items = [
    {
      "@type": "ListItem",
      position: 1,
      name: "bgcut",
      item: `${SITE_ORIGIN}/`,
    },
  ];

  if (isGuidePage(page)) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: "Guides",
      item: `${SITE_ORIGIN}/guides`,
    });
    items.push({
      "@type": "ListItem",
      position: 3,
      name: GUIDES[page].title,
      item: url,
    });
  } else if (isComparisonPage(page)) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: "Comparisons",
      item: `${SITE_ORIGIN}/compare`,
    });
    items.push({
      "@type": "ListItem",
      position: 3,
      name: COMPARISONS[page].title,
      item: url,
    });
  } else if (isToolPage(page)) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: "Tools",
      item: `${SITE_ORIGIN}/tools`,
    });
    items.push({
      "@type": "ListItem",
      position: 3,
      name: SITE_TOOLS[page].title,
      item: url,
    });
  } else if (page !== "home") {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: metadata.title,
      item: url,
    });
  }

  return {
    "@type": "BreadcrumbList",
    itemListElement: items,
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

  if (isToolPage(page)) {
    const tool = SITE_TOOLS[page];

    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebApplication",
          "@id": `${url}#app`,
          name: tool.title,
          url,
          description: tool.description,
          applicationCategory: "UtilityApplication",
          operatingSystem: "Any",
          isAccessibleForFree: true,
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
          },
        },
        breadcrumbStructuredDataForPage(page),
      ],
    };
  }

  if (isGuidePage(page)) {
    const guide = GUIDES[page];

    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Article",
          "@id": `${url}#article`,
          headline: guide.title,
          description: guide.description,
          datePublished: guide.publishedAt,
          dateModified: guide.updatedAt,
          mainEntityOfPage: url,
          image: `${SITE_ORIGIN}/og-image.png`,
          author: {
            "@type": "Organization",
            name: "bgcut",
            url: `${SITE_ORIGIN}/`,
          },
          publisher: {
            "@type": "Organization",
            name: "bgcut",
            url: `${SITE_ORIGIN}/`,
          },
        },
        breadcrumbStructuredDataForPage(page),
      ],
    };
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type":
          page === "changelog" || page === "guides" || page === "compare" || page === "tools"
            ? "CollectionPage"
            : "WebPage",
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
