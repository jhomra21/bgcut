# Search and Lighthouse operations

Use this checklist after deploying changes that affect bgcut.dev search metadata, routes, or page performance.

## Search Console

Submit this sitemap:

`https://bgcut.dev/sitemap.xml`

The sitemap intentionally includes only the public pages that should appear in search results:

- `https://bgcut.dev/`
- `https://bgcut.dev/docs`
- `https://bgcut.dev/changelog`

Privacy and Terms remain crawlable from the footer but use `noindex` and are not listed in the sitemap.

After a meaningful content or metadata change, use URL Inspection on the three indexable URLs above. Confirm that the inspected canonical matches the URL being inspected, then request indexing when the rendered page looks correct.

Use the Performance report to watch:

- queries that show bgcut
- pages receiving impressions
- click-through rate by query and page
- query terms around background removal, browser background removal, WebGPU, CLI, and Node.js APIs

Do not add repetitive keywords solely to chase impressions. Keep search language in visible headings and copy only when it accurately describes the page.

## Lighthouse

The hosted homepage should keep its inference stack out of the initial JavaScript path. Browser processing code is loaded only after image selection.

Secondary navigation and footer text must keep at least WCAG AA contrast against the normal site background.

Cloudflare Web Analytics injects `beacon.min.js` when automatic Web Analytics is enabled. Search Console does not require that beacon. If Cloudflare RUM data is not useful for bgcut, disable automatic Web Analytics in the Cloudflare dashboard to remove that third-party request from Lighthouse runs.

## Route metadata

The root `index.html` contains the homepage metadata and WebApplication structured data.

Hosted builds generate route-specific HTML files for Docs, Changelog, Privacy, and Terms. Keep their title, description, canonical, and robots values in `src/shared/site-metadata.ts`. Do not duplicate those values in page components.

The packaged local app does not generate or expose these hosted metadata routes.
