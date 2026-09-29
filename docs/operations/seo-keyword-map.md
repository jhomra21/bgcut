# SEO keyword map

This map assigns one primary search intent to each indexable bgcut.dev page. It is the source of truth for new search pages and articles.

The map does not claim search volume. Add volume, impressions, clicks, click-through rate, and average position only from Search Console or a named keyword-data provider. Do not estimate those numbers.

## Positioning

bgcut has two audiences:

- People who want to remove a background without uploading the source image.
- Developers who want local background removal from Node.js or a command line instead of a hosted per-image API.

The browser, CLI, and Node.js API all use local inference. Keep that distinction explicit. bgcut does not offer a hosted background-removal HTTP API.

Searches for the name "bgcut" are not enough to identify this project. Other products use similar names. Prefer descriptive copy such as "bgcut.dev local background remover" when a page needs brand context.

## Page map

| Target page | Primary intent | Supporting searches | User | Page job | Status |
| --- | --- | --- | --- | --- | --- |
| `/` | free background remover | remove background from image, background remover online, free image background remover | Anyone removing one image | Let the visitor remove a background immediately, then explain local processing and supported formats | Live |
| `/private-background-remover` | private background remover | no upload background remover, local background remover, background remover no signup, browser background remover | Privacy-sensitive users | Explain exactly what stays on the device and give direct access to the remover | Planned |
| `/node-background-removal` | Node.js background removal | background removal npm, remove background Node.js, JavaScript background removal Node | Node.js developers | Show the current `bgcut()` object API, reuse, errors, formats, and local runtime behavior | Planned |
| `/background-removal-cli` | background remover CLI | remove background command line, image background removal terminal, local background removal CLI | Developers and automation users | Show single-file commands, engine selection, output formats, and directory input | Planned |
| `/batch-background-remover` | batch background remover | bulk background remover, batch remove image backgrounds, remove backgrounds from folder | People processing many files | Explain sequential warm-runtime processing for multiple files and directories | Planned |
| `/open-source-background-remover` | open source background remover | local open source background remover, self-hosted background removal, offline background remover | Developers and privacy-sensitive users | Explain the MIT-licensed project, local runtimes, deployment choices, and limits | Planned |
| `/benchmarks` | background removal benchmark | WebGPU background removal benchmark, local background remover performance, browser background removal speed | Technical evaluators | Publish reproducible measurements with device, browser, image size, runtime, version, and fixtures | Planned |
| `/docs` | bgcut documentation | bgcut Node API, bgcut CLI, bgcut local app | Existing users | Hold the complete product contract and link to intent-specific pages for deeper examples | Live |
| `/changelog` | bgcut changelog | bgcut release notes, bgcut updates | Existing users | Record shipped changes and give search engines dated product facts | Live |

## Article map

Articles answer informational searches. Each article links to one primary product page. An article should not target the same main query as its product page.

| Article | Question it answers | Primary page it supports |
| --- | --- | --- |
| `/guides/remove-background-without-uploading` | How can I remove an image background without uploading the image? | `/private-background-remover` |
| `/guides/webgpu-vs-webassembly-background-removal` | Should browser background removal use WebGPU or WebAssembly? | `/private-background-remover` |
| `/guides/node-js-background-removal` | How do I remove an image background in Node.js? | `/node-background-removal` |
| `/guides/batch-background-removal-cli` | How do I remove backgrounds from a folder or batch from the command line? | `/background-removal-cli` and `/batch-background-remover` |
| `/guides/how-local-background-removal-works` | How does local AI background removal work? | `/open-source-background-remover` |
| `/guides/png-webp-jpeg-transparency` | Which image format should I use after background removal? | `/docs` |
| `/guides/background-removal-privacy` | What does "no upload" mean for a browser background remover? | `/private-background-remover` |
| `/guides/browser-cli-or-node-background-removal` | Should I use a browser tool, CLI, or Node.js API? | `/docs` |
| `/guides/background-removal-benchmark-method` | How should local background-removal performance be measured? | `/benchmarks` |
| `/guides/remove-bg-migration-local-inference` | Can a remove.bg workflow move from a hosted API to local inference? | `/remove-bg-api-alternative` |

Do not publish a benchmark article until its measurements and fixtures are in the repository.

## Comparison map

Comparison pages come after the question-led articles. They must state cases where the other product is the better fit.

| Target page | Search intent | Required comparison |
| --- | --- | --- |
| `/remove-bg-alternative` | remove.bg alternative | Hosted product workflow versus bgcut local browser, CLI, and Node.js use |
| `/remove-bg-api-alternative` | remove.bg API alternative | Hosted HTTP API migration versus local Node.js or CLI processing. State that bgcut is not a drop-in hosted API |
| `/compare/bg0` | bgcut vs BG0 | Browser-only library and app versus bgcut browser, CLI, and Node.js choices |
| `/compare/imgly-background-removal` | bgcut vs @imgly/background-removal | Browser and Node package choices, runtime behavior, licenses, output, and integration model |
| `/compare/rembg` | bgcut vs rembg | JavaScript and native Node workflow versus Python and rembg ecosystem |

Comparison claims need a dated source or a reproducible local check. Do not publish guessed pricing, quality rankings, or unsupported performance claims.

## Free-tool map

Only add a tool when it can reuse code we already maintain or solve a nearby image task without weakening the background remover.

| Candidate | Search intent | Product fit |
| --- | --- | --- |
| Transparency checker | check PNG transparency, alpha channel checker | Uses image decode and alpha inspection without model inference |
| Transparent image format guide/checker | PNG vs WebP transparency, does JPEG support transparency | Fits current PNG, WebP, and JPEG output behavior |
| Transparent whitespace cropper | crop transparent PNG, trim transparent pixels | Can reuse local image processing and transparent output |
| Background color replacer | change transparent background color | Natural follow-up after removal if implemented in the product pipeline |

Do not create calculators or generators with no connection to bgcut.

## Internal-link rules

Every indexable page should link to the page that owns its main intent. Articles should link to their primary product page near the first useful example, not only in a footer.

The homepage should link to privacy, Node.js, CLI, batch, open-source, and benchmark pages once those pages exist. Product pages can link to related guides. Comparison pages should link to the relevant product page and docs.

Do not use the same anchor text for unrelated destinations. Do not create near-duplicate pages for singular, plural, "AI", "online", or "free" keyword variants.

## Measurement

After a page is indexed, record its Search Console queries against this map. Reassign a query only when another page consistently receives the impressions and better matches the intent.

Prioritize pages with one of these signals:

- impressions with average position between 5 and 20
- high impressions with low click-through rate and a title that does not match the query
- a query landing on the wrong bgcut page
- an indexable page with no impressions after enough crawl time to diagnose indexing and intent

Keep observed Search Console data separate from this planning file.
