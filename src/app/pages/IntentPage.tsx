import { For, Show } from "@solidjs/web";

import { INTENT_PAGES, type IntentPage, type IntentPageId } from "../../shared/intent-pages";
import { CodeBlock } from "../components/CodeBlock";
import { ResourcePage } from "../components/ResourcePage";

export const IntentPageView = (props: { readonly page: IntentPageId }) => {
  const content = (): IntentPage => INTENT_PAGES[props.page];

  return (
    <ResourcePage page={props.page} pageClass="intent-page">
        <h1>{content().title}</h1>
        <p class="guide-summary">{content().summary}</p>

        <div class="intent-actions">
          <a class="intent-primary-link" href={content().ctaHref}>{content().ctaLabel}</a>
          <Show when={content().guideHref}>
            {(href) => <a href={href()}>Read the guide</a>}
          </Show>
        </div>

        <For each={content().sections}>
          {(section) => (
            <section>
              <h2>{section.title}</h2>
              <For each={section.paragraphs}>{(paragraph) => <p>{paragraph}</p>}</For>

              <Show when={section.bullets}>
                {(items) => (
                  <ul>
                    <For each={items()}>{(item) => <li>{item}</li>}</For>
                  </ul>
                )}
              </Show>

              <Show when={section.code}>
                {(code) => <CodeBlock language={code().language} code={code().code} />}
              </Show>
            </section>
          )}
        </For>
    </ResourcePage>
  );
};
