# Repository documentation

bgcut keeps user-facing package documentation in the root `README.md`. The hosted documentation lives at `bgcut.dev/docs`, and `bgcut.dev/llms.txt` provides a concise machine-readable public reference. The files here cover repository operation, engineering records, and planned work.

## Operations

- [`operations/deploying.md`](operations/deploying.md): Cloudflare Workers, R2, local deployment checks, and production verification.
- [`operations/releasing.md`](operations/releasing.md): npm Trusted Publishing and the release process.
- [`operations/search-console.md`](operations/search-console.md): Search Console, sitemap, route metadata, and Lighthouse checks.
- [`operations/seo-keyword-map.md`](operations/seo-keyword-map.md): target queries, page ownership, article topics, comparisons, and adjacent tools.
- [`operations/search-claims.md`](operations/search-claims.md): canonical public claims and the product changes that require a search-content review.
- [`operations/ai-search.md`](operations/ai-search.md): answer-engine questions, correction workflow, and AI-search baseline.
- [`operations/seo-competitors.md`](operations/seo-competitors.md): competitor sources, query clusters, and weekly watch rules.
- [`operations/seo-distribution.md`](operations/seo-distribution.md): directory targets and selective outreach rules.
- [`operations/seo-reporting.md`](operations/seo-reporting.md): weekly and monthly search reporting.
- [`marketing/seo-social.md`](marketing/seo-social.md): ready-to-post copy for the new search pages and tool.

## Engineering

- [`engineering/benchmarks.md`](engineering/benchmarks.md): recorded performance results and comparison rules.
- [`engineering/graph-capture.md`](engineering/graph-capture.md): the accepted WebGPU graph-capture work and its measured history.

## Roadmap

- [`roadmap.md`](roadmap.md): work outside the current public product contract.


## Public release history

- [`../CHANGELOG.md`](../CHANGELOG.md) is the release-notes source of truth.
- The hosted site renders only full stable `X.Y.Z` release sections at [`bgcut.dev/changelog`](https://bgcut.dev/changelog).
- Date-only notes and prerelease sections stay out of the website changelog.
- GitHub release notes are extracted from the matching version section.
