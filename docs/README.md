# Repository documentation

bgcut keeps public package usage in the root `README.md`. This directory holds engineering and operations material that is useful when changing or maintaining the repository.

## Architecture

- [Repository layout](architecture/repository.md) explains the source boundaries and why bgcut remains one package.

## Engineering

- [Benchmarks](engineering/benchmarks.md) records measured runtime results and comparison rules.
- [WebGPU graph capture](engineering/graph-capture.md) documents the accepted graph-capture work and its exact benchmark context.
- [Roadmap](engineering/roadmap.md) tracks work outside the current public product contract.

## Operations

- [Deploying](operations/deploying.md) covers Cloudflare Workers, R2, local deployment checks, and production deployment.
- [Releasing](operations/releasing.md) covers npm Trusted Publishing, beta acceptance, and stable promotion.

Images used by the root README live in `docs/images/`.
