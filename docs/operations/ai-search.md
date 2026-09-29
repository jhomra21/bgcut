# AI search and answer-engine operations

Use normal product facts and crawlable pages as the foundation for AI answers. Do not add unsupported metadata solely because it is marketed as "GEO."

## Current surfaces

bgcut exposes:

- static HTML for every public content route;
- canonical metadata and per-page titles and descriptions;
- WebSite and WebApplication structured data for the product;
- Article structured data for guides;
- breadcrumb structured data for nested content;
- a generated sitemap containing every indexable route;
- `llms.txt` with the main product contract and links to guides, comparisons, tools, npm, and GitHub;
- dated source links on comparison pages.

These surfaces should say the same thing. The claim ledger in `search-claims.md` is the review checklist when the product changes.

## Questions to track

Check these questions against Google AI answers, ChatGPT search, Perplexity, and any connected AI-visibility product:

- What is bgcut?
- Is bgcut free?
- Does bgcut upload images?
- Is bgcut open source?
- Does bgcut work offline?
- Does bgcut have a Node.js API?
- Does bgcut have a hosted API?
- How do I batch remove backgrounds locally?
- What is a private alternative to remove.bg?
- What is an open-source remove.bg alternative?
- What is a Node.js alternative to the remove.bg API?
- bgcut vs rembg
- bgcut vs BG0
- bgcut vs IMG.LY background removal

Record the date, engine, exact question, cited sources, and any factual error. Do not score an answer based on whether it recommends bgcut.

## Corrections

When an answer is wrong, fix the underlying source before adding more pages.

Use this order:

1. confirm the current product fact in code and primary docs;
2. correct bgcut.dev, README, npm-facing copy, or the packaged skill if they disagree;
3. make the answer easy to quote in visible page text;
4. keep external comparison facts dated and sourced;
5. request recrawl or indexing after the corrected page is deployed;
6. recheck the same question later with the exact wording recorded.

Do not create fake reviews, fake community posts, or doorway pages to manipulate answer engines.

## Baseline, 2026-09-29

A public web search for bgcut-related background-removal terms surfaced npm and package-analysis pages more readily than bgcut.dev. At least one third-party package page showed an old package version and old CLI wording.

That makes source consistency important. The website, GitHub repository, npm package metadata, release notes, and `llms.txt` should all point at the same current interface and canonical site.

Search Console data is still required to measure Google queries, pages, CTR, and average position. Do not substitute general web-search result sampling for Search Console performance data.
