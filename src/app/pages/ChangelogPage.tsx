import { For, Show } from "@solidjs/web";

import changelogSource from "../../../CHANGELOG.md?raw";
import { ReferencePage } from "../components/ReferencePage";
import {
  type SectionRailGroup,
  type SectionRailItem,
} from "../components/SectionRail";

type ChangelogSection = {
  readonly id: string;
  readonly version: string;
  readonly heading: string;
  readonly items: readonly string[];
};

type ChangelogDocument = {
  readonly title: string;
  readonly sections: readonly ChangelogSection[];
};

const releaseHeading = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? - \d{4}-\d{2}-\d{2}$/u;

const releaseId = (version: string): string =>
  `release-${version.replaceAll(".", "-")}`;

const parseChangelog = (source: string): ChangelogDocument => {
  const lines = source.split(/\r?\n/u);
  const sections: ChangelogSection[] = [];
  let title = "Changelog";
  let heading: string | undefined;
  let items: string[] = [];

  const finishSection = () => {
    if (heading !== undefined && releaseHeading.test(heading)) {
      const separatorIndex = heading.indexOf(" - ");
      const version = separatorIndex < 0 ? heading : heading.slice(0, separatorIndex);

      sections.push({
        id: releaseId(version),
        version,
        heading,
        items,
      });
    }

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

    if (line.startsWith("- ") && heading !== undefined) {
      items.push(line.slice(2));
    }
  }

  finishSection();

  return { title, sections };
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

const releaseItems: SectionRailItem[] = [];

for (const section of document.sections) {
  releaseItems.push({
    id: section.id,
    label: section.version,
  });
}

const releaseGroups: readonly SectionRailGroup[] = [
  {
    label: "Releases",
    items: releaseItems,
  },
];

const latestReleaseId = document.sections[0]?.id ?? "release";

const oldestReleaseId =
  document.sections[document.sections.length - 1]?.id ?? latestReleaseId;

export const ChangelogPage = () => (
  <ReferencePage
    title={document.title}
    pageClass="changelog-page"
    railAriaLabel="Changelog releases"
    railGroups={releaseGroups}
    initialSectionId={latestReleaseId}
    bottomSectionId={oldestReleaseId}
  >

        <For each={document.sections}>
          {(section) => (
            <section id={section.id} class="reference-section changelog-release">
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
  </ReferencePage>
);
