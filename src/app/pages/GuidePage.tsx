import { For, Show } from "@solidjs/web";

import { GUIDES, GUIDE_PAGE_IDS, type Guide, type GuidePageId } from "../../shared/guides";
import { ContentBreadcrumb } from "../components/ContentBreadcrumb";
import { GuideVisualBlock } from "../components/GuideVisual";
import { CodeBlock } from "../components/CodeBlock";
import { ResourcePage } from "../components/ResourcePage";

const pathForGuide = (guide: Guide): string => `/guides/${guide.slug}`;

export const GuideIndexPage = () => (
  <ResourcePage page="guides" pageClass="guide-index">
      <h1>Local background removal guides</h1>
      <p class="guide-summary">
        Practical notes for browser privacy, WebGPU and WebAssembly, Effect, Node.js, CLI
        batches, image formats, and the bgcut processing pipeline.
      </p>

      <div class="guide-list">
        <For each={GUIDE_PAGE_IDS}>
          {(page) => {
            const guide = GUIDES[page];

            return (
              <a href={pathForGuide(guide)}>
                <strong>{guide.title}</strong>
                <span>{guide.description}</span>
              </a>
            );
          }}
        </For>
      </div>
  </ResourcePage>
);

export const GuidePage = (props: { readonly page: GuidePageId }) => {
  const guide = (): Guide => GUIDES[props.page];

  return (
    <ResourcePage page={props.page} pageClass="guide-detail-page">
      <ContentBreadcrumb
        parentHref="/guides"
        parentLabel="Guides"
        currentLabel={guide().title}
      />
      <h1>{guide().title}</h1>
      <p class="guide-summary">{guide().summary}</p>
      <p class="guide-date">
        Published <time datetime={guide().publishedAt}>{guide().publishedAt}</time>
      </p>

      <For each={guide().sections}>
        {(section) => (
          <section id={section.id}>
            <h2>{section.title}</h2>

            <For each={section.paragraphs}>
              {(paragraph) => <p>{paragraph}</p>}
            </For>

            <Show when={section.bullets}>
              {(bullets) => (
                <ul>
                  <For each={bullets()}>{(item) => <li>{item}</li>}</For>
                </ul>
              )}
            </Show>

            <Show when={section.visual}>
              {(visual) => <GuideVisualBlock visual={visual()} />}
            </Show>

            <Show when={section.code}>
              {(code) => <CodeBlock language={code().language} code={code().code} />}
            </Show>
          </section>
        )}
      </For>

      <nav class="guide-next" aria-label="Guide resources">
        <a href="/">Use the background remover</a>
        <a href="/docs">Read the bgcut docs</a>
      </nav>
    </ResourcePage>
  );
};
