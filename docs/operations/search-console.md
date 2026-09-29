# Search and Lighthouse operations

Use this checklist after deploying changes that affect bgcut.dev search metadata, routes, or page performance.

## Search Console

Submit this sitemap:

`https://bgcut.dev/sitemap.xml`

The build generates the sitemap from `INDEXED_SITE_PAGES` in `src/shared/site-metadata.ts`. Do not maintain a second hand-written URL list here.

Privacy and Terms remain crawlable from the footer but use `noindex` and are not listed in the generated sitemap.

After a meaningful content or metadata change, use URL Inspection on the affected indexable URLs. Confirm that the inspected canonical matches the URL being inspected, then request indexing when the rendered page looks correct.

Use the Performance report to watch:

- queries that show bgcut
- pages receiving impressions
- click-through rate by query and page
- query terms around background removal, browser background removal, WebGPU, CLI, and Node.js API

Do not add repetitive keywords solely to chase impressions. Keep search language in visible headings and copy only when it accurately describes the page.

## Lighthouse

The hosted homepage should keep its inference stack out of the initial JavaScript path. Browser processing code is loaded only after image selection.

Secondary navigation and footer text must keep at least WCAG AA contrast against the normal site background.

Cloudflare Web Analytics injects `beacon.min.js` when automatic Web Analytics is enabled. Search Console does not require that beacon. If Cloudflare RUM data is not useful for bgcut, disable automatic Web Analytics in the Cloudflare dashboard to remove that third-party request from Lighthouse runs.

The hosted static app also ships security headers from `public/_headers`. Keep the CSP compatible with the same-origin JavaScript chunks, blob image previews, WebAssembly compilation, and Cloudflare's analytics beacon. Hashed `/assets/*` files use one-year immutable browser caching.

Do not add `require-trusted-types-for 'script'` only to satisfy Lighthouse. Trusted Types enforcement should be introduced only after validating Solid and every browser-processing dependency against the policy.

## Route metadata

The root `index.html` contains the homepage metadata and WebApplication structured data.

Hosted builds generate route-specific HTML for every public route, including nested guides, comparisons, and tools. Keep title, description, canonical, indexing state, and route paths in the shared metadata registry instead of duplicating them in components.

`bun run site:audit` checks the generated HTML, sitemap, canonicals, robots directives, structured data, H1 count, duplicate indexed metadata, and internal route links. Both normal and Cloudflare builds run it.

The packaged local app does not generate or expose these hosted content routes.
