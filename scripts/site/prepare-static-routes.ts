import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  COMPARISONS,
  COMPARISON_PAGE_IDS,
  isComparisonPage,
  pathForComparison,
  type Comparison,
} from "../../src/shared/comparisons";
import { GUIDES, GUIDE_PAGE_IDS, isGuidePage, type Guide } from "../../src/shared/guides";
import { INTENT_PAGES, isIntentPage, type IntentPage } from "../../src/shared/intent-pages";
import { isToolPage } from "../../src/shared/tools";
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

const staticFooterCurrent = (
  page: PublicSitePage,
  section: "guides" | "tools" | "compare" | "changelog" | "privacy" | "terms",
): boolean => {
  if (section === "guides") {
    return page === "guides" || isGuidePage(page);
  }

  if (section === "tools") {
    return page === "tools" || isToolPage(page);
  }

  if (section === "compare") {
    return page === "compare" || isComparisonPage(page);
  }

  return page === section;
};

const staticAriaCurrent = (current: boolean): string =>
  current ? ' aria-current="page"' : "";

const staticBreadcrumb = (
  parentHref: string,
  parentLabel: string,
  currentLabel: string,
): string => `<nav class="content-breadcrumb" aria-label="Breadcrumb">
  <ol>
    <li><a href="${parentHref}">${htmlEscape(parentLabel)}</a></li>
    <li class="content-breadcrumb-separator" aria-hidden="true">/</li>
    <li aria-current="page">${htmlEscape(currentLabel)}</li>
  </ol>
</nav>`;

const staticFooter = (page: PublicSitePage): string => `<footer class="site-footer">
  <div class="site-footer-meta">
    <a class="site-footer-brand brand-link" href="/" aria-label="bgcut home"${staticAriaCurrent(page === "home")}>bgcut</a>
    <span>MIT licensed</span>
  </div>
  <nav class="site-footer-links" aria-label="Footer navigation">
    <a href="/guides"${staticAriaCurrent(staticFooterCurrent(page, "guides"))}>Guides</a>
    <a href="/tools"${staticAriaCurrent(staticFooterCurrent(page, "tools"))}>Tools</a>
    <a href="/compare"${staticAriaCurrent(staticFooterCurrent(page, "compare"))}>Compare</a>
    <a href="/changelog"${staticAriaCurrent(staticFooterCurrent(page, "changelog"))}>Changelog</a>
    <a href="/privacy"${staticAriaCurrent(staticFooterCurrent(page, "privacy"))}>Privacy</a>
    <a href="/terms"${staticAriaCurrent(staticFooterCurrent(page, "terms"))}>Terms</a>
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
  <section class="home-resources" aria-label="Background removal resources">
    <a href="/private-background-remover"><strong>Private browser removal</strong><span>What stays on your device and what the site downloads.</span></a>
    <a href="/node-background-removal"><strong>Node.js API</strong><span>Run local background removal inside application code.</span></a>
    <a href="/background-removal-cli"><strong>CLI</strong><span>Process files and folders from the command line.</span></a>
    <a href="/batch-background-remover"><strong>Batch removal</strong><span>Reuse one runtime across multiple images.</span></a>
    <a href="/open-source-background-remover"><strong>Open source</strong><span>Inspect the MIT-licensed implementation and local runtimes.</span></a>
    <a href="/tools/transparency-checker"><strong>Transparency checker</strong><span>Inspect alpha pixels without uploading the image.</span></a>
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
      <p><a href="/guides">Guides</a>, <a href="/llms.txt">agent index</a>, <a href="https://github.com/jhomra21/bgcut/blob/main/src/node/index.d.ts">Node API types</a>, <a href="https://www.npmjs.com/package/bgcut">npm package</a>, and <a href="https://github.com/jhomra21/bgcut">GitHub repository</a>.</p>
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

const staticIntentPage = (content: IntentPage): string => {
  const sections = content.sections.map((section) => {
    const paragraphs = section.paragraphs
      .map((paragraph) => `<p>${htmlEscape(paragraph)}</p>`)
      .join("");

    const bullets = section.bullets === undefined
      ? ""
      : `<ul>${section.bullets.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>`;

    const code = section.code === undefined
      ? ""
      : `<pre><code>${htmlEscape(section.code.code)}</code></pre>`;

    return `<section><h2>${htmlEscape(section.title)}</h2>${paragraphs}${bullets}${code}</section>`;
  }).join("");

  const guideLink = content.guideHref === undefined
    ? ""
    : `<a href="${content.guideHref}">Read the guide</a>`;

  return `<main class="page-content legal-shell">
    <article class="guide-page intent-page">
      <h1>${htmlEscape(content.title)}</h1>
      <p class="guide-summary">${htmlEscape(content.summary)}</p>
      <div class="intent-actions">
        <a class="intent-primary-link" href="${htmlEscape(content.ctaHref)}">${htmlEscape(content.ctaLabel)}</a>
        ${guideLink}
      </div>
      ${sections}
    </article>
  </main>`;
};

const staticGuideIndex = (): string => {
  const items = GUIDE_PAGE_IDS.map((page) => {
    const guide = GUIDES[page];

    return `<a href="/guides/${guide.slug}"><strong>${htmlEscape(guide.title)}</strong><span>${htmlEscape(guide.description)}</span></a>`;
  }).join("");

  return `<main class="page-content legal-shell">
    <article class="guide-page guide-index">
      <h1>Local background removal guides</h1>
      <p class="guide-summary">Practical notes for browser privacy, WebGPU and WebAssembly, Node.js, CLI batches, image formats, and the bgcut processing pipeline.</p>
      <div class="guide-list">${items}</div>
    </article>
  </main>`;
};

const staticGuide = (guide: Guide): string => {
  const sections = guide.sections.map((section) => {
    const paragraphs = section.paragraphs
      .map((paragraph) => `<p>${htmlEscape(paragraph)}</p>`)
      .join("");

    const bullets = section.bullets === undefined
      ? ""
      : `<ul>${section.bullets.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>`;

    const code = section.code === undefined
      ? ""
      : `<pre><code>${htmlEscape(section.code.code)}</code></pre>`;

    return `<section id="${section.id}">
      <h2>${htmlEscape(section.title)}</h2>
      ${paragraphs}
      ${bullets}
      ${code}
    </section>`;
  }).join("");

  return `<main class="page-content legal-shell">
    <article class="guide-page">
      ${staticBreadcrumb("/guides", "Guides", guide.title)}
      <h1>${htmlEscape(guide.title)}</h1>
      <p class="guide-summary">${htmlEscape(guide.summary)}</p>
      <p class="guide-date">Published <time datetime="${guide.publishedAt}">${guide.publishedAt}</time></p>
      ${sections}
      <nav class="guide-next" aria-label="Guide resources">
        <a href="/">Use the background remover</a>
        <a href="/docs">Read the bgcut docs</a>
      </nav>
    </article>
  </main>`;
};

const staticComparisonIndex = (): string => {
  const items = COMPARISON_PAGE_IDS.map((page) => {
    const comparison = COMPARISONS[page];

    return `<a href="${pathForComparison(comparison)}"><strong>${htmlEscape(comparison.title)}</strong><span>${htmlEscape(comparison.description)}</span></a>`;
  }).join("");

  return `<main class="page-content legal-shell">
    <article class="guide-page comparison-index">
      <h1>Background removal alternatives and comparisons</h1>
      <p class="guide-summary">Factual comparisons based on documented interfaces, deployment models, and licenses. Quality and performance are left unranked unless a reproducible benchmark exists.</p>
      <div class="guide-list">${items}</div>
    </article>
  </main>`;
};

const staticComparison = (comparison: Comparison): string => {
  const rows = comparison.rows.map((row) => `<tr>
    <th scope="row">${htmlEscape(row.label)}</th>
    <td>${htmlEscape(row.bgcut)}</td>
    <td>${htmlEscape(row.other)}</td>
  </tr>`).join("");

  const bgcutItems = comparison.chooseBgcut
    .map((item) => `<li>${htmlEscape(item)}</li>`)
    .join("");

  const otherItems = comparison.chooseOther
    .map((item) => `<li>${htmlEscape(item)}</li>`)
    .join("");

  const sections = comparison.sections.map((section) => {
    const paragraphs = section.paragraphs
      .map((paragraph) => `<p>${htmlEscape(paragraph)}</p>`)
      .join("");

    return `<section><h2>${htmlEscape(section.title)}</h2>${paragraphs}</section>`;
  }).join("");

  const sources = comparison.sources
    .map((source) => `<li><a href="${htmlEscape(source.href)}">${htmlEscape(source.label)}</a></li>`)
    .join("");

  return `<main class="page-content legal-shell">
    <article class="guide-page comparison-page">
      ${staticBreadcrumb("/compare", "Compare", comparison.title)}
      <h1>${htmlEscape(comparison.title)}</h1>
      <p class="guide-summary">${htmlEscape(comparison.intro)}</p>
      <p class="guide-date">Facts checked <time datetime="${comparison.checkedAt}">${comparison.checkedAt}</time></p>
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <thead><tr><th>Area</th><th>bgcut</th><th>${htmlEscape(comparison.otherName)}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <section><h2>Choose bgcut when</h2><ul>${bgcutItems}</ul></section>
      <section><h2>Choose ${htmlEscape(comparison.otherName)} when</h2><ul>${otherItems}</ul></section>
      ${sections}
      <section>
        <h2>Sources</h2>
        <p>External product facts above were checked on ${comparison.checkedAt}.</p>
        <ul>${sources}</ul>
      </section>
    </article>
  </main>`;
};

const staticToolIndex = (): string => `<main class="page-content legal-shell">
  <article class="guide-page tool-index">
    <h1>Free image tools</h1>
    <p class="guide-summary">Small local utilities for checking image files before or after background removal.</p>
    <div class="guide-list">
      <a href="/tools/transparency-checker">
        <strong>Image transparency checker</strong>
        <span>Find fully transparent, partially transparent, and opaque pixels without uploading the image.</span>
      </a>
    </div>
  </article>
</main>`;

const staticTransparencyChecker = (): string => `<main class="page-content legal-shell">
  <article class="guide-page tool-page">
    ${staticBreadcrumb("/tools", "Tools", "Image transparency checker")}
    <h1>Image transparency checker</h1>
    <p class="guide-summary">Check whether an image contains transparent or partially transparent pixels. The file is decoded and inspected in your browser. It is not uploaded to bgcut.</p>
    <section>
      <h2>Check an image</h2>
      <p>Choose a PNG, JPEG, WebP, or AVIF image. JavaScript enables the local pixel checker on this page.</p>
    </section>
    <section>
      <h2>What the result means</h2>
      <p>A fully transparent pixel has alpha 0. A partially transparent pixel has alpha between 1 and 254. An opaque pixel has alpha 255.</p>
      <p>PNG and WebP can store alpha transparency. JPEG cannot. AVIF can contain alpha when the encoded image includes it.</p>
    </section>
    <section>
      <h2>Why check transparency</h2>
      <p>A checker can confirm that a cutout really contains alpha instead of a white or checkerboard background baked into the pixels.</p>
      <p>If you need to create a transparent cutout first, use the <a href="/">bgcut background remover</a>.</p>
    </section>
  </article>
</main>`;

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

  if (isIntentPage(page)) {
    return staticIntentPage(INTENT_PAGES[page]);
  }

  if (page === "changelog") {
    return staticChangelog(changelogSource);
  }

  if (page === "guides") {
    return staticGuideIndex();
  }

  if (isGuidePage(page)) {
    return staticGuide(GUIDES[page]);
  }

  if (page === "compare") {
    return staticComparisonIndex();
  }

  if (isComparisonPage(page)) {
    return staticComparison(COMPARISONS[page]);
  }

  if (page === "tools") {
    return staticToolIndex();
  }

  if (isToolPage(page)) {
    return staticTransparencyChecker();
  }

  return staticLegal(page);
};

const staticPageShell = (
  page: PublicSitePage,
  changelogSource: string,
): string => `<div class="site-root" data-static-route="${page}">
  <div class="site-header-shell">${staticHeader(page)}</div>
  <div class="route-stage">${staticContentForPage(page, changelogSource)}</div>
  <div class="site-footer-shell">${staticFooter(page)}</div>
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

const outputPathForPage = (page: PublicSitePage, templatePath: string): string => {
  if (page === "home") {
    return templatePath;
  }

  const routePath = SITE_PAGE_METADATA[page].path.replace(/^\//u, "");

  return resolve(distDirectory, `${routePath}.html`);
};

const templatePath = resolve(distDirectory, "index.html");

const template = await readFile(templatePath, "utf8");

const changelogSource = await readFile(changelogPath, "utf8");

for (const page of PUBLIC_SITE_PAGES) {
  const html = renderPageHtml(template, page, changelogSource);
  const outputPath = outputPathForPage(page, templatePath);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html);
  console.log(`Prepared static route ${SITE_PAGE_METADATA[page].path}.`);
}

await writeFile(resolve(distDirectory, "sitemap.xml"), renderSitemap());

console.log(`Prepared sitemap for ${INDEXED_SITE_PAGES.length} indexable routes.`);
