import { isComparisonPage } from "./comparisons";
import { isGuidePage } from "./guides";
import type { IntentPageId } from "./intent-pages";
import type { PublicSitePage } from "./site-metadata";
import { isToolPage } from "./tools";

export type ResourceNavItem = {
  readonly page: "guides" | "tools" | "compare" | IntentPageId;
  readonly label: string;
};

export type ResourceNavGroup = {
  readonly label: string;
  readonly items: readonly ResourceNavItem[];
};

export const RESOURCE_NAV_GROUPS: readonly ResourceNavGroup[] = [
  {
    label: "Resources",
    items: [
      { page: "guides", label: "Guides" },
      { page: "tools", label: "Tools" },
      { page: "compare", label: "Compare" },
    ],
  },
  {
    label: "Use bgcut",
    items: [
      { page: "intent-private-background-remover", label: "Private browser" },
      { page: "intent-node-background-removal", label: "Node.js" },
      { page: "intent-background-removal-cli", label: "CLI" },
      { page: "intent-batch-background-remover", label: "Batch" },
      { page: "intent-open-source-background-remover", label: "Open source" },
    ],
  },
];

export type ResourceNavCurrent = "page" | "location" | undefined;

export const resourceNavCurrent = (
  page: PublicSitePage,
  target: ResourceNavItem["page"],
): ResourceNavCurrent => {
  if (page === target) {
    return "page";
  }

  if (target === "guides" && isGuidePage(page)) {
    return "location";
  }

  if (target === "tools" && isToolPage(page)) {
    return "location";
  }

  if (target === "compare" && isComparisonPage(page)) {
    return "location";
  }

  return undefined;
};
