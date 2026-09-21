import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalUrlForPage,
  SITE_PAGE_METADATA,
  structuredDataForPage,
  type PublicSitePage,
} from "../../src/shared/site-metadata";

const root = resolve(import.meta.dir, "../..");
const distDirectory = resolve(root, "dist");

const htmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const jsonForHtml = (value: ReturnType<typeof structuredDataForPage>): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

const renderPageHtml = (template: string, page: PublicSitePage): string => {
  const metadata = SITE_PAGE_METADATA[page];
  const canonicalUrl = canonicalUrlForPage(page);
  const robots = metadata.index
    ? "index, follow, max-image-preview:large"
    : "noindex, follow, max-image-preview:large";

  return template
    .replace(/<title>[^<]*<\/title>/u, `<title>${htmlEscape(metadata.title)}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*("\s*\/?>)/u,
      `$1${htmlEscape(metadata.description)}$2`,
    )
    .replace(
      /(<meta\s+name="robots"\s+content=")[^"]*("\s*\/?>)/u,
      `$1${robots}$2`,
    )
    .replace(
      /(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/?>)/u,
      `$1${canonicalUrl}$2`,
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*("\s*\/?>)/u,
      `$1${htmlEscape(metadata.title)}$2`,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*("\s*\/?>)/u,
      `$1${htmlEscape(metadata.description)}$2`,
    )
    .replace(
      /(<meta\s+property="og:url"\s+content=")[^"]*("\s*\/?>)/u,
      `$1${canonicalUrl}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:title"\s+content=")[^"]*("\s*\/?>)/u,
      `$1${htmlEscape(metadata.title)}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*("\s*\/?>)/u,
      `$1${htmlEscape(metadata.description)}$2`,
    )
    .replace(
      /(<script\s+id="site-structured-data"\s+type="application\/ld\+json">)[\s\S]*?(<\/script>)/u,
      `$1${jsonForHtml(structuredDataForPage(page))}$2`,
    );
};

const templatePath = resolve(distDirectory, "index.html");
const template = await readFile(templatePath, "utf8");

for (const page of ["docs", "changelog", "privacy", "terms"] as const) {
  const html = renderPageHtml(template, page);
  const outputPath = resolve(distDirectory, `${page}.html`);

  await writeFile(outputPath, html);
  console.log(`Prepared static metadata route ${SITE_PAGE_METADATA[page].path}.`);
}
