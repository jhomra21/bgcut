import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  INDEXED_SITE_PAGES,
  PUBLIC_SITE_PAGES,
  SITE_PAGE_METADATA,
  canonicalUrlForPage,
  type PublicSitePage,
} from "../../src/shared/site-metadata";

const root = resolve(import.meta.dir, "../..");

const distDirectory = resolve(root, "dist");

const outputPathForPage = (page: PublicSitePage): string => {
  if (page === "home") {
    return resolve(distDirectory, "index.html");
  }

  return resolve(
    distDirectory,
    `${SITE_PAGE_METADATA[page].path.replace(/^\//u, "")}.html`,
  );
};

const failures: string[] = [];

let checks = 0;

const check = (condition: boolean, message: string): void => {
  checks += 1;

  if (!condition) {
    failures.push(message);
  }
};

const matchContent = (html: string, pattern: RegExp): string | undefined =>
  pattern.exec(html)?.[1];

const normalizeInternalHref = (href: string): string =>
  (href.split("#", 1)[0] ?? "/").replace(/\/+$/u, "") || "/";

const publicPaths = new Set(
  PUBLIC_SITE_PAGES.map((page) => SITE_PAGE_METADATA[page].path),
);

const indexedPaths = new Set(
  INDEXED_SITE_PAGES.map((page) => SITE_PAGE_METADATA[page].path),
);

const seenTitles = new Map<string, string>();

const seenDescriptions = new Map<string, string>();

const seenCanonicals = new Set<string>();

const sitemap = await readFile(resolve(distDirectory, "sitemap.xml"), "utf8");

const robots = await readFile(resolve(distDirectory, "robots.txt"), "utf8");

check(
  robots.includes("Sitemap: https://bgcut.dev/sitemap.xml"),
  "robots.txt must advertise the production sitemap.",
);

for (const page of PUBLIC_SITE_PAGES) {
  const metadata = SITE_PAGE_METADATA[page];

  const html = await readFile(outputPathForPage(page), "utf8");

  const canonical = canonicalUrlForPage(page);

  const title = matchContent(html, /<title>([^<]+)<\/title>/u);

  const description = matchContent(
    html,
    /<meta\s+name="description"\s+content="([^"]*)"/u,
  );

  const robotsContent = matchContent(
    html,
    /<meta\s+name="robots"\s+content="([^"]*)"/u,
  );

  const canonicalHref = matchContent(
    html,
    /<link\s+rel="canonical"\s+href="([^"]*)"/u,
  );

  const ogUrl = matchContent(
    html,
    /<meta\s+property="og:url"\s+content="([^"]*)"/u,
  );

  const h1Count = html.match(/<h1(?:\s[^>]*)?>/gu)?.length ?? 0;

  const structuredData = matchContent(
    html,
    /<script\s+id="site-structured-data"\s+type="application\/ld\+json">([\s\S]*?)<\/script>/u,
  );

  check(title === metadata.title, `${metadata.path}: title does not match route metadata.`);
  check(
    description === metadata.description,
    `${metadata.path}: description does not match route metadata.`,
  );
  check(
    canonicalHref === canonical,
    `${metadata.path}: canonical does not match its public URL.`,
  );
  check(ogUrl === canonical, `${metadata.path}: og:url does not match canonical.`);
  check(h1Count === 1, `${metadata.path}: expected one static h1, found ${h1Count}.`);
  check(structuredData !== undefined, `${metadata.path}: structured data is missing.`);

  if (structuredData !== undefined) {
    try {
      JSON.parse(structuredData);
      check(true, `${metadata.path}: structured data parses.`);
    } catch {
      check(false, `${metadata.path}: structured data is not valid JSON.`);
    }
  }

  if (metadata.index) {
    check(
      robotsContent?.startsWith("index, follow") === true,
      `${metadata.path}: indexable page must use index, follow.`,
    );
    check(
      sitemap.includes(`<loc>${canonical}</loc>`),
      `${metadata.path}: indexable page is missing from sitemap.xml.`,
    );

    const existingTitlePath = seenTitles.get(metadata.title);

    check(
      existingTitlePath === undefined,
      `${metadata.path}: duplicate title also used by ${existingTitlePath ?? "another page"}.`,
    );
    seenTitles.set(metadata.title, metadata.path);

    const existingDescriptionPath = seenDescriptions.get(metadata.description);

    check(
      existingDescriptionPath === undefined,
      `${metadata.path}: duplicate description also used by ${existingDescriptionPath ?? "another page"}.`,
    );
    seenDescriptions.set(metadata.description, metadata.path);
  } else {
    check(
      robotsContent?.startsWith("noindex, follow") === true,
      `${metadata.path}: non-indexed page must use noindex, follow.`,
    );
    check(
      !sitemap.includes(`<loc>${canonical}</loc>`),
      `${metadata.path}: noindex page must not appear in sitemap.xml.`,
    );
  }

  check(
    !seenCanonicals.has(canonical),
    `${metadata.path}: canonical URL is duplicated.`,
  );
  seenCanonicals.add(canonical);

  const hrefs = [...html.matchAll(/href="(\/[^"]*)"/gu)].map((match) => match[1]);

  for (const href of hrefs) {
    if (
      href.startsWith("/assets/") ||
      href.startsWith("/favicon") ||
      href.startsWith("/apple-touch") ||
      href.startsWith("/icon-") ||
      href === "/site.webmanifest" ||
      href === "/llms.txt"
    ) {
      continue;
    }

    const path = normalizeInternalHref(href);

    check(
      publicPaths.has(path),
      `${metadata.path}: internal link ${href} does not map to a public route.`,
    );
  }
}

for (const page of INDEXED_SITE_PAGES) {
  const path = SITE_PAGE_METADATA[page].path;

  check(indexedPaths.has(path), `${path}: indexed route registry mismatch.`);
}

const sitemapEntries = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
  (match) => match[1],
);

check(
  sitemapEntries.length === INDEXED_SITE_PAGES.length,
  `sitemap.xml has ${sitemapEntries.length} URLs, expected ${INDEXED_SITE_PAGES.length}.`,
);

if (failures.length > 0) {
  throw new Error(
    `SEO audit failed after ${checks} checks:\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  `SEO audit passed ${checks} checks across ${PUBLIC_SITE_PAGES.length} public routes.`,
);
