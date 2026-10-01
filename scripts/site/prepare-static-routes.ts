import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { build } from "vite";

import {
  canonicalUrlForPage,
  INDEXED_SITE_PAGES,
  PUBLIC_SITE_PAGES,
  SITE_PAGE_METADATA,
  structuredDataForPage,
  type PublicSitePage,
} from "../../src/shared/site-metadata";
import { SITE_HYDRATION_RENDER_ID } from "../../src/shared/hydration";

const root = resolve(import.meta.dir, "../..");

const distDirectory = resolve(root, "dist");

const ssrDirectory = resolve(root, ".site-ssr");

const ssrEntryPath = resolve(ssrDirectory, "server-entry.mjs");

const clientTemplatePath = resolve(distDirectory, "index.html");

const hydrationAssetName = "solid-hydration.js";

const hydrationAssetPath = resolve(distDirectory, hydrationAssetName);

type ServerRenderer = {
  readonly renderHostedApp: (page: PublicSitePage) => string;
  readonly hydrationBootstrapSource: () => string;
};

const htmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const jsonForHtml = (value: ReturnType<typeof structuredDataForPage>): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

const buildServerRenderer = async (): Promise<ServerRenderer> => {
  await rm(ssrDirectory, { recursive: true, force: true });

  await build({
    configFile: resolve(root, "vite.config.ts"),
    mode: "site-ssr",
    publicDir: false,
    build: {
      ssr: resolve(root, "src/app/server-entry.ts"),
      outDir: ssrDirectory,
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: "server-entry.mjs",
        },
      },
    },
  });

  try {
    // SAFETY: the SSR build has one controlled entry and exports the ServerRenderer contract below.
    return await import(pathToFileURL(ssrEntryPath).href) as ServerRenderer;
  } catch (error) {
    const stack = error instanceof Error ? error.stack ?? "" : String(error);
    const location = /server-entry\.mjs:(\d+):\d+/u.exec(stack);
    const lineNumber = location === null ? undefined : Number(location[1]);

    if (lineNumber !== undefined) {
      const source = await readFile(ssrEntryPath, "utf8");
      const lines = source.split("\n");
      const start = Math.max(0, lineNumber - 6);
      const end = Math.min(lines.length, lineNumber + 5);

      console.error(
        `SSR bundle context around line ${lineNumber}:\n${lines
          .slice(start, end)
          .map((line, index) => `${start + index + 1}: ${line}`)
          .join("\n")}`,
      );
    }

    throw error;
  }
};

const renderPageHtml = (
  template: string,
  page: PublicSitePage,
  appHtml: string,
): string => {
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
    )
    .replace(
      '<script src="/theme-bootstrap.js"></script>',
      '<script src="/theme-bootstrap.js"></script>\n    <script src="/solid-hydration.js"></script>',
    )
    .replace(
      '<div id="root"></div>',
      `<div id="root" data-bgcut-hydrate="${SITE_HYDRATION_RENDER_ID}">${appHtml}</div>`,
    );
};

const renderSitemap = (): string => {
  const urls = INDEXED_SITE_PAGES.map((page) => {
    const metadata = SITE_PAGE_METADATA[page];

    return `  <url>
    <loc>${canonicalUrlForPage(page)}</loc>
    <lastmod>${metadata.lastModified}</lastmod>
  </url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
};

const outputPathForPage = (page: PublicSitePage, templatePath: string): string => {
  if (page === "home") {
    return templatePath;
  }

  const routePath = SITE_PAGE_METADATA[page].path.replace(/^\//u, "");

  return resolve(distDirectory, `${routePath}.html`);
};

const template = await readFile(clientTemplatePath, "utf8");

try {
  const server = await buildServerRenderer();
  const hydrationSource = server.hydrationBootstrapSource();

  new Script(hydrationSource, { filename: hydrationAssetName });

  await writeFile(hydrationAssetPath, hydrationSource);

  for (const page of PUBLIC_SITE_PAGES) {
    const appHtml = server.renderHostedApp(page);
    const html = renderPageHtml(template, page, appHtml);
    const outputPath = outputPathForPage(page, clientTemplatePath);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html);
    console.log(`Prepared hydratable static route ${SITE_PAGE_METADATA[page].path}.`);
  }

  await writeFile(resolve(distDirectory, "sitemap.xml"), renderSitemap());
  console.log(`Prepared sitemap for ${INDEXED_SITE_PAGES.length} indexable routes.`);
} finally {
  await rm(ssrDirectory, { recursive: true, force: true });
}
