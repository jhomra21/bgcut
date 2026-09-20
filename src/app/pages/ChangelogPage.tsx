import { For, Show } from "@solidjs/web";

import changelogSource from "../../../CHANGELOG.md?raw";

type ChangelogSection = {
  readonly heading: string;
  readonly items: readonly string[];
};

type ChangelogDocument = {
  readonly title: string;
  readonly intro: readonly string[];
  readonly sections: readonly ChangelogSection[];
};

const parseChangelog = (source: string): ChangelogDocument => {
  const lines = source.split(/\r?\n/u);
  const intro: string[] = [];
  const sections: ChangelogSection[] = [];
  let title = "Changelog";
  let heading: string | undefined;
  let items: string[] = [];

  const finishSection = () => {
    if (heading === undefined) {
      return;
    }

    sections.push({ heading, items });
    heading = undefined;
    items = [];
  };

  for (const line of lines) {
    if (line.startsWith("# ")) {
      title = line.slice(2);
      continue;
    }

    if (line.startsWith("## ")) {
      finishSection();
      heading = line.slice(3);
      continue;
    }

    if (line.startsWith("- ")) {
      if (heading !== undefined) {
        items.push(line.slice(2));
      }
      continue;
    }

    if (line.length > 0 && heading === undefined) {
      intro.push(line);
    }
  }

  finishSection();

  return { title, intro, sections };
};

const inlineParts = (value: string): readonly string[] =>
  value.split(/(`[^`]+`)/u);

const InlineText = (props: { readonly text: string }) => (
  <For each={inlineParts(props.text)}>
    {(part) =>
      part.startsWith("`") && part.endsWith("`")
        ? <code>{part.slice(1, -1)}</code>
        : part
    }
  </For>
);

const document = parseChangelog(changelogSource);

export const ChangelogPage = () => (
  <main class="page-content content-shell">
    <article class="changelog-page">
      <header class="changelog-header">
        <div class="eyebrow">Releases</div>
        <h2>{document.title}</h2>
        <For each={document.intro}>
          {(paragraph) => <p>{paragraph}</p>}
        </For>
      </header>

      <For each={document.sections}>
        {(section) => (
          <section class="changelog-release">
            <h3>{section.heading}</h3>
            <Show when={section.items.length > 0}>
              <ul>
                <For each={section.items}>
                  {(item) => <li><InlineText text={item} /></li>}
                </For>
              </ul>
            </Show>
          </section>
        )}
      </For>
    </article>
  </main>
);
