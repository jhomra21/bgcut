# Repository documentation

bgcut keeps user-facing package documentation in the root `README.md`. The files here cover repository operation, engineering records, and planned work.

## Operations

- [`operations/deploying.md`](operations/deploying.md): Cloudflare Workers, R2, local deployment checks, and production verification.
- [`operations/releasing.md`](operations/releasing.md): npm Trusted Publishing, beta acceptance, and stable promotion.
- [`operations/search-console.md`](operations/search-console.md): Search Console, sitemap, route metadata, and Lighthouse checks.

## Engineering

- [`engineering/benchmarks.md`](engineering/benchmarks.md): recorded performance results and comparison rules.
- [`engineering/graph-capture.md`](engineering/graph-capture.md): the accepted WebGPU graph-capture work and its measured history.

## Roadmap

- [`roadmap.md`](roadmap.md): work outside the current public product contract.


## Public release history

- The repository source of truth is [`../CHANGELOG.md`](../CHANGELOG.md).
- The hosted site renders that same file at [`bgcut.dev/changelog`](https://bgcut.dev/changelog).
- GitHub release notes are extracted from the matching version section of the same file.
