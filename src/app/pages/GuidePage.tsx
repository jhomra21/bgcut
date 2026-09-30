import { For, Show } from "@solidjs/web";

import { ContentBreadcrumb } from "../components/ContentBreadcrumb";
import { CodeBlock } from "../components/CodeBlock";
import { ResourceRailPage } from "../components/ResourceRailPage";
import type { SectionRailGroup, SectionRailLinkGroup } from "../components/SectionRail";
import { GUIDES, GUIDE_PAGE_IDS, type Guide, type GuidePageId } from "../../shared/guides";

const pathForGuide = (guide: Guide): string => `/guides/${guide.slug}`;

const GUIDE_EXPLORE_LINKS: readonly SectionRailLinkGroup[] = [
  {
    label: "Explore bgcut",
    divided: true,
    items: [
      { href: "/docs", label: "Docs" },
      { href: "/tools", label: "Tools" },
      { href: "/compare", label: "Compare" },
    ],
  },
];

export const GuideIndexPage = () => (
  <main class="page-content legal-shell">
    <article class="guide-page guide-index">
      <h1>Local background removal guides</h1>
      <p class="guide-summary">
        Practical notes for browser privacy, WebGPU and WebAssembly, Node.js, CLI batches,
        image formats, and the bgcut processing pipeline.
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
    </article>
  </main>
);

export const GuidePage = (props: { readonly page: GuidePageId }) => {
  const guide = (): Guide => GUIDES[props.page];

  const railGroups = (): readonly SectionRailGroup[] => [
    {
      label: "This guide",
      items: guide().sections.map((section) => ({
        id: section.id,
        label: section.title,
      })),
    },
  ];

  return (
    <ResourceRailPage
      areaTitle="Guides"
      allHref="/guides"
      allLabel="All guides"
      railAriaLabel="Guide navigation"
      groups={railGroups()}
      initialSectionId={guide().sections[0]?.id ?? ""}
      sectionSelector=".resource-content-page > section[id]"
      bottomSectionId={guide().sections.at(-1)?.id}
      exploreLinks={GUIDE_EXPLORE_LINKS}
      pageClass="guide-detail-page"
    >
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
    </ResourceRailPage>
  );
};
