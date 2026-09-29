import { For } from "@solidjs/web";

import {
  COMPARISONS,
  COMPARISON_PAGE_IDS,
  type Comparison,
  type ComparisonPageId,
} from "../../shared/comparisons";

const pathForComparison = (comparison: Comparison): string =>
  comparison.slug.startsWith("remove-bg")
    ? `/${comparison.slug}`
    : `/compare/${comparison.slug}`;

export const ComparisonIndexPage = () => (
  <main class="page-content legal-shell">
    <article class="guide-page comparison-index">
      <p class="guide-kicker">Comparisons</p>
      <h1>Background removal alternatives and comparisons</h1>
      <p class="guide-summary">
        Factual comparisons based on documented interfaces, deployment models, and licenses.
        Quality and performance are left unranked unless a reproducible benchmark exists.
      </p>

      <div class="guide-list">
        <For each={COMPARISON_PAGE_IDS}>
          {(page) => {
            const comparison = COMPARISONS[page];

            return (
              <a href={pathForComparison(comparison)}>
                <strong>{comparison.title}</strong>
                <span>{comparison.description}</span>
              </a>
            );
          }}
        </For>
      </div>
    </article>
  </main>
);

export const ComparisonPage = (props: { readonly page: ComparisonPageId }) => {
  const comparison = (): Comparison => COMPARISONS[props.page];

  return (
    <main class="page-content legal-shell">
      <article class="guide-page comparison-page">
        <p class="guide-kicker"><a href="/compare">Comparisons</a></p>
        <h1>{comparison().title}</h1>
        <p class="guide-summary">{comparison().intro}</p>
        <p class="guide-date">
          Facts checked <time datetime={comparison().checkedAt}>{comparison().checkedAt}</time>
        </p>

        <div class="comparison-table-wrap">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Area</th>
                <th>bgcut</th>
                <th>{comparison().otherName}</th>
              </tr>
            </thead>
            <tbody>
              <For each={comparison().rows}>
                {(row) => (
                  <tr>
                    <th scope="row">{row.label}</th>
                    <td>{row.bgcut}</td>
                    <td>{row.other}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        <section>
          <h2>Choose bgcut when</h2>
          <ul>
            <For each={comparison().chooseBgcut}>{(item) => <li>{item}</li>}</For>
          </ul>
        </section>

        <section>
          <h2>Choose {comparison().otherName} when</h2>
          <ul>
            <For each={comparison().chooseOther}>{(item) => <li>{item}</li>}</For>
          </ul>
        </section>

        <For each={comparison().sections}>
          {(section) => (
            <section>
              <h2>{section.title}</h2>
              <For each={section.paragraphs}>{(paragraph) => <p>{paragraph}</p>}</For>
            </section>
          )}
        </For>

        <section>
          <h2>Sources</h2>
          <p>External product facts above were checked on {comparison().checkedAt}.</p>
          <ul>
            <For each={comparison().sources}>
              {(source) => (
                <li>
                  <a href={source.href} target="_blank" rel="noreferrer">{source.label}</a>
                </li>
              )}
            </For>
          </ul>
        </section>
      </article>
    </main>
  );
};
