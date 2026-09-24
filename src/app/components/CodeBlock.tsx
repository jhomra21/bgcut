import { For, createSignal, onCleanup } from "solid-js";

type CodeLanguage = "shell" | "typescript" | "text";

type CopyState = "idle" | "copied" | "error";

type TokenKind =
  | "comment"
  | "command"
  | "function"
  | "keyword"
  | "number"
  | "option"
  | "string"
  | "type";

type CodeToken = {
  readonly text: string;
  readonly kind?: TokenKind;
};

const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  shell: "Shell",
  typescript: "TypeScript",
  text: "Text",
};

const TS_KEYWORDS = new Set([
  "await",
  "catch",
  "const",
  "finally",
  "from",
  "if",
  "import",
  "instanceof",
  "let",
  "try",
  "type",
]);

const TS_TYPES = new Set([
  "ArrayBuffer",
  "BgcutError",
  "RemoveBackgroundResult",
  "Uint8Array",
  "number",
  "string",
]);

const TS_FUNCTIONS = new Set([
  "console",
  "createBgcut",
  "removeBackground",
  "writeFile",
]);

const SHELL_COMMANDS = new Set(["bgcut", "bunx", "npm", "npx"]);

const shellPattern =
  /#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|--[a-z0-9-]+|-[a-z]\b|\b(?:bgcut|bunx|npm|npx)\b|\b\d+\b/giu;

const typescriptPattern =
  /\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:await|catch|const|finally|from|if|import|instanceof|let|try|type)\b|\b(?:ArrayBuffer|BgcutError|RemoveBackgroundResult|Uint8Array|number|string)\b|\b(?:console|createBgcut|removeBackground|writeFile)\b|\b(?:false|null|true|undefined)\b|\b\d+(?:\.\d+)?\b/gu;

const tokenKind = (value: string, language: CodeLanguage): TokenKind | undefined => {
  if (value.startsWith("#") || value.startsWith("//")) {
    return "comment";
  }

  if (
    value.startsWith('"') ||
    value.startsWith("'") ||
    value.startsWith("`")
  ) {
    return "string";
  }

  if (/^\d/u.test(value)) {
    return "number";
  }

  if (language === "shell") {
    if (value.startsWith("-")) {
      return "option";
    }

    return SHELL_COMMANDS.has(value) ? "command" : undefined;
  }

  if (TS_KEYWORDS.has(value) || value === "true" || value === "false" || value === "null" || value === "undefined") {
    return "keyword";
  }

  if (TS_TYPES.has(value)) {
    return "type";
  }

  return TS_FUNCTIONS.has(value) ? "function" : undefined;
};

const tokenizeLine = (line: string, language: CodeLanguage): readonly CodeToken[] => {
  if (language === "text") {
    return [{ text: line }];
  }

  const pattern = language === "shell" ? shellPattern : typescriptPattern;
  pattern.lastIndex = 0;

  const tokens: CodeToken[] = [];
  let cursor = 0;

  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;

    if (index > cursor) {
      tokens.push({ text: line.slice(cursor, index) });
    }

    const text = match[0];
    tokens.push({ text, kind: tokenKind(text, language) });
    cursor = index + text.length;
  }

  if (cursor < line.length) {
    tokens.push({ text: line.slice(cursor) });
  }

  return tokens;
};

const tokenize = (source: string, language: CodeLanguage): readonly CodeToken[] => {
  const lines = source.split("\n");
  const tokens: CodeToken[] = [];

  for (const [index, line] of lines.entries()) {
    tokens.push(...tokenizeLine(line, language));

    if (index < lines.length - 1) {
      tokens.push({ text: "\n" });
    }
  }

  return tokens;
};

export const CodeBlock = (props: {
  readonly code: string;
  readonly language: CodeLanguage;
}) => {
  const [copyState, setCopyState] = createSignal<CopyState>("idle");
  let resetTimer: number | undefined;

  const resetCopyState = () => {
    if (resetTimer !== undefined) {
      window.clearTimeout(resetTimer);
    }

    resetTimer = window.setTimeout(() => {
      resetTimer = undefined;
      setCopyState("idle");
    }, 1400);
  };

  const copy = () => {
    if (navigator.clipboard?.writeText === undefined) {
      setCopyState("error");
      resetCopyState();

      return;
    }

    void navigator.clipboard.writeText(props.code)
      .then(() => {
        setCopyState("copied");
        resetCopyState();
      })
      .catch(() => {
        setCopyState("error");
        resetCopyState();
      });
  };

  onCleanup(() => {
    if (resetTimer !== undefined) {
      window.clearTimeout(resetTimer);
    }
  });

  const copyLabel = () => {
    const state = copyState();

    if (state === "copied") {
      return "Copied";
    }

    if (state === "error") {
      return "Copy failed";
    }

    return "Copy";
  };

  return (
    <div class="code-block" data-language={props.language}>
      <div class="code-block-toolbar">
        <span class="code-block-language">{LANGUAGE_LABELS[props.language]}</span>
        <button
          class="code-block-copy"
          type="button"
          data-copy-state={copyState()}
          aria-label={`Copy ${LANGUAGE_LABELS[props.language]} code`}
          onClick={copy}
        >
          {copyState() === "copied" ? (
            <svg class="code-block-copy-check" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m3 8.4 3.1 3.1L13 4.6" />
            </svg>
          ) : (
            <svg class="code-block-copy-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="5.25" y="5.25" width="7.5" height="7.5" rx="1.5" />
              <path d="M3.75 10.75h-.5A1.5 1.5 0 0 1 1.75 9.25v-6A1.5 1.5 0 0 1 3.25 1.75h6a1.5 1.5 0 0 1 1.5 1.5v.5" />
            </svg>
          )}
          <span aria-live="polite">{copyLabel()}</span>
        </button>
      </div>
      <pre><code><For each={tokenize(props.code, props.language)}>
        {(token) =>
          token.kind === undefined
            ? token.text
            : <span class={`code-token code-token-${token.kind}`}>{token.text}</span>
        }
      </For></code></pre>
    </div>
  );
};
