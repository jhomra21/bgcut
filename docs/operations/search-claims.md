# Search claim ledger

Use this file when writing or reviewing bgcut.dev pages, comparison pages, social copy, directory listings, and outreach.

A claim belongs here when it is repeated outside the API reference and could become false after a product change. The implementation or contract document named in the source column wins over this summary.

## Current product claims

| Claim | Current wording | Source of truth | Review trigger |
| --- | --- | --- | --- |
| Hosted inference | bgcut.dev runs background-removal inference on the user's device. It does not send the source image to a bgcut inference backend. | `src/browser/`, Privacy page, `public/llms.txt` | browser inference or network behavior changes |
| Browser engines | Automatic browser mode tries WebGPU and can fall back to WebAssembly. | browser engine selector and hosted docs | provider selection or fallback changes |
| Native engines | Native automatic mode tries WebGPU and can use CPU when runtime creation cannot use WebGPU. Explicit GPU does not silently become CPU. | Node/CLI engine code and `src/node/index.d.ts` | native engine selection changes |
| Interfaces | bgcut has a hosted browser app, packaged local app, CLI, and Node.js API. | package bin/exports, hosted docs | interface added, removed, or renamed |
| Hosted HTTP API | bgcut does not offer a hosted background-removal HTTP API. | product architecture | an HTTP inference service is introduced |
| Node API | Open a reusable instance with `bgcut()`, use `removeBackground()` or `removeMany()`, then `close()`. | `src/node/index.d.ts` | Node API changes |
| Batch behavior | `removeMany()` and CLI batch processing are sequential and reuse one runtime. Per-image Node batch failures are yielded. | Node implementation/types and CLI | batch scheduling or failure behavior changes |
| Input formats | JPEG, PNG, WebP, and AVIF are documented inputs. | decoder contract and docs | decoder support changes |
| Transparent outputs | PNG is the default transparent output. Lossless WebP can preserve transparency. JPEG is flattened onto white. | encoders and CLI/Node docs | output encoding changes |
| Model input | The public segmentation model works at 512 x 512 and the matte is restored to source dimensions for export. | model config and processing pipeline | model or preprocessing changes |
| Model packaging | The npm tarball does not include the model artifacts. Cached models are validated before reuse. | package files, model cache code | package/model distribution changes |
| License | bgcut source is MIT licensed. | `LICENSE`, `package.json` | license changes |
| Price | bgcut does not charge a per-image hosted inference fee because bgcut does not provide hosted inference. Local compute and third-party infrastructure still have their own costs. | architecture and product offering | hosted billing or paid product is introduced |
| Signup | The hosted background remover does not require a bgcut account to process an image. | hosted app | authentication is introduced |

## Wording rules

Keep local-processing claims specific. Say what remains on the device and distinguish it from normal downloads of application, runtime, and model files.

Do not write "offline" for the initial hosted experience. The page needs its code, runtime, and model before cached resources can be reused.

Do not call the Node API a hosted API. "Node API" means a JavaScript API that runs in the caller's process.

Do not claim a performance, output-quality, or accuracy advantage without a dated reproducible benchmark that tests the compared systems on the same inputs and environment.

Do not turn "no bgcut per-image service charge" into "free compute." The caller supplies the device or infrastructure.

Comparison pages must keep a dated source link for external product facts. Recheck them when the source changes or before refreshing the page's checked date.

## Release review

When a release changes one of the review triggers above:

1. update the implementation and primary product documentation;
2. search `src/shared/guides.ts`, `src/shared/comparisons.ts`, `public/llms.txt`, website metadata, README, and the packaged skill for the old claim;
3. update affected pages in the same change;
4. run `bun run check`, which includes the generated-site audit;
5. update comparison checked dates only for facts that were actually re-verified.

Do not update a date merely to make a page look fresh.
