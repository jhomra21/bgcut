export const TOOL_PAGE_IDS = ["tool-transparency-checker"] as const;

export type ToolPageId = (typeof TOOL_PAGE_IDS)[number];

export type SiteTool = {
  readonly page: ToolPageId;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
};

export const SITE_TOOLS: Readonly<Record<ToolPageId, SiteTool>> = {
  "tool-transparency-checker": {
    page: "tool-transparency-checker",
    slug: "transparency-checker",
    title: "Image transparency checker",
    description:
      "Check whether a PNG, WebP, JPEG, or AVIF image contains transparent or partially transparent pixels. The file stays in your browser.",
  },
};

export const isToolPage = (page: string): page is ToolPageId =>
  Object.hasOwn(SITE_TOOLS, page);
