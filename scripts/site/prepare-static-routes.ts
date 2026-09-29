import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalUrlForPage,
  INDEXED_SITE_PAGES,
  PUBLIC_SITE_PAGES,
  SITE_PAGE_METADATA,
  structuredDataForPage,
  type PublicSitePage,
} from "../../src/shared/site-metadata";

const root = resolve(import.meta.dir, "../..");

const distDirectory = resolve(root, "dist");

const changelogPath = resolve(root, "CHANGELOG.md");

const htmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const jsonForHtml = (value: ReturnType<typeof structuredDataForPage>): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

const staticHeader = (page: PublicSitePage): string => {
  const docsCurrent = page === "docs" ? ' aria-current="page"' : "";
  const changelogCurrent = page === "changelog" ? ' aria-current="page"' : "";

  return `<header class="app-header">
    <a class="brand-link" href="/" aria-label="bgcut home">
      <div class="brand-title">
        <img class="brand-mark" src="/favicon-48x48.png?v=2" alt="" width="32" height="32" aria-hidden="true" />
        <span>bgcut</span>
      </div>
    </a>
    <nav class="site-nav" aria-label="Main navigation">
      <a href="/docs"${docsCurrent}>Docs</a>
      <a href="/changelog"${changelogCurrent}>Changelog</a>
      <a href="https://github.com/jhomra21/bgcut">GitHub</a>
    </nav>
  </header>`;
};

const staticFooter = (): string => `<footer class="site-footer">
  <div class="site-footer-meta">
    <a class="site-footer-brand brand-link" href="/" aria-label="bgcut home">bgcut</a>
    <span>MIT licensed</span>
  </div>
  <nav class="site-footer-links" aria-label="Footer navigation">
    <a href="/changelog">Changelog</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </nav>
</footer>`;

const staticHome = (): string => `<main class="page-content home-shell">
  <div class="home-intro">
    <h1>Free, private background remover</h1>
    <p>Remove backgrounds from PNG, JPEG, WebP, and AVIF images in your browser. Processing runs on your device with WebGPU when available.</p>
  </div>
  <section class="drop-surface" aria-label="Background remover">
    <div class="drop-trigger">
      <span class="drop-trigger-copy">
        <strong>Click or drag image here</strong>
        <span class="drop-trigger-format">JPEG, PNG, WebP, or AVIF</span>
      </span>
    </div>
  </section>
</main>`;

const staticDocs = (): string => `<main class="page-content content-shell">
  <article class="content-page reference-page docs-page">
    <h1>Documentation</h1>
    <section id="quickstart" class="reference-section doc-section">
      <h2>Quickstart</h2>
      <p>Run the local web app from npm without installing bgcut globally.</p>
      <pre><code>npx bgcut</code></pre>
      <p>For headless removal, run <code>npx bgcut photo.jpg</code>. For application code, install bgcut and use the Node.js API.</p>
    </section>
    <section id="web-ui" class="reference-section doc-section">
      <h2>Web UI</h2>
      <p>Choose, drag, or paste a JPEG, PNG, WebP, or AVIF image. bgcut removes the background in the browser and lets you inspect, copy, or download the result.</p>
      <p>Automatic browser mode tries ONNX Runtime WebGPU first and falls back to WebAssembly when needed. Inference runs on the user's device.</p>
    </section>
    <section id="local-app" class="reference-section doc-section">
      <h2>Local app</h2>
      <p>Run <code>npx bgcut</code> or <code>bgcut serve</code> to start the packaged remover on <code>127.0.0.1</code>.</p>
    </section>
    <section id="cli" class="reference-section doc-section">
      <h2>CLI</h2>
      <p>Use bgcut for file-in/file-out removal, shell scripts, multiple files, and recursive directory batches.</p>
      <pre><code>bgcut photo.jpg
bgcut first.jpg second.png
bgcut photos/ -o ./cutouts</code></pre>
    </section>
    <section id="node-api" class="reference-section doc-section">
      <h2>Node API</h2>
      <p>Create one reusable bgcut instance, remove one or many images, then close it when finished.</p>
      <pre><code>import { bgcut } from "bgcut";

const remover = await bgcut();
const result = await remover.removeBackground("photo.jpg");
await remover.close();</code></pre>
    </section>
    <section id="model" class="reference-section doc-section">
      <h2>Model and runtime</h2>
      <p>The browser uses local ONNX Runtime inference. The CLI and Node.js API use the native runtime. The npm package does not include the model artifacts.</p>
    </section>
    <section id="architecture" class="reference-section doc-section">
      <h2>Architecture</h2>
      <p>Browser input is decoded locally, resized and normalized for inference, then the matte is restored to the source dimensions before export.</p>
    </section>
    <section id="resources" class="reference-section doc-section">
      <h2>Resources</h2>
      <p><a href="/llms.txt">Agent index</a>, <a href="https://github.com/jhomra21/bgcut/blob/main/src/node/index.d.ts">Node API types</a>, <a href="https://www.npmjs.com/package/bgcut">npm package</a>, and <a href="https://github.com/jhomra21/bgcut">GitHub repository</a>.</p>
    </section>
  </article>
</main>`;

const parseChangelog = (source: string): readonly { version: string; date: string; items: readonly string[] }[] => {
  const sections: { version: string; date: string; items: string[] }[] = [];
  let version: string | undefined;
  let date: string | undefined;
  let items: string[] = [];

  const finish = () => {
    if (version !== undefined && date !== undefined) {
      sections.push({ version, date, items });
    }

    version = undefined;
    date = undefined;
    items = [];
  };

  for (const line of source.split(/\r?\n/u)) {
    if (line.startsWith("## ")) {
      finish();
      const heading = line.slice(3);
      const match = /^(\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})$/u.exec(heading);

      if (match !== null) {
        version = match[1];
        date = match[2];
      }

      continue;
    }

    if (line.startsWith("- ") && version !== undefined) {
      items.push(line.slice(2));
    }
  }

  finish();

  return sections;
};

const staticChangelog = (source: string): string => {
  const releases = parseChangelog(source);

  const sections = releases.map((release) => {
    const items = release.items
      .map((item) => `<li>${htmlEscape(item)}</li>`)
      .join("");

    return `<section class="reference-section changelog-release">
      <h2 class="changelog-release-heading"><span>${htmlEscape(release.version)}</span> <time datetime="${htmlEscape(release.date)}">${htmlEscape(release.date)}</time></h2>
      <ul>${items}</ul>
    </section>`;
  }).join("");

  return `<main class="page-content content-shell">
    <article class="content-page reference-page changelog-page">
      <h1>Changelog</h1>
      ${sections}
    </article>
  </main>`;
};

const staticLegal = (page: "privacy" | "terms"): string => {
  const metadata = SITE_PAGE_METADATA[page];
  const heading = page === "privacy" ? "Privacy" : "Terms of Use";

  return `<main class="page-content legal-shell">
    <article class="legal-page">
      <h1>${heading}</h1>
      <p>${htmlEscape(metadata.description)}</p>
    </article>
  </main>`;
};

const staticContentForPage = (page: PublicSitePage, changelogSource: string): string => {
  if (page === "home") {
    return staticHome();
  }

  if (page === "docs") {
    return staticDocs();
  }

  if (page === "changelog") {
    return staticChangelog(changelogSource);
  }

  return staticLegal(page);
};

const staticPageShell = (
  page: PublicSitePage,
  changelogSource: string,
): string => `<div class="site-root" data-static-route="${page}">
  <div class="site-header-shell">${staticHeader(page)}</div>
  <div class="route-stage">${staticContentForPage(page, changelogSource)}</div>
  <div class="site-footer-shell">${staticFooter()}</div>
</div>`;

const renderPageHtml = (
  template: string,
  page: PublicSitePage,
  changelogSource: string,
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
      '<div id="root"></div>',
      `<div id="root">${staticPageShell(page, changelogSource)}</div>`,
    );
};

const renderSitemap = (): string => {
  const urls = INDEXED_SITE_PAGES.map(
    (page) => `  <url>
    <loc>${canonicalUrlForPage(page)}</loc>
  </url>`,
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
};

const templatePath = resolve(distDirectory, "index.html");

const template = await readFile(templatePath, "utf8");

const changelogSource = await readFile(changelogPath, "utf8");

for (const page of PUBLIC_SITE_PAGES) {
  const html = renderPageHtml(template, page, changelogSource);

  const outputPath =
    page === "home"
      ? templatePath
      : resolve(distDirectory, `${page}.html`);

  await writeFile(outputPath, html);
  console.log(`Prepared static route ${SITE_PAGE_METADATA[page].path}.`);
}

await writeFile(resolve(distDirectory, "sitemap.xml"), renderSitemap());

console.log(`Prepared sitemap for ${INDEXED_SITE_PAGES.length} indexable routes.`);
