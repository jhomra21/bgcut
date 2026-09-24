import { Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";

import ComparisonSlider from "../components/ComparisonSlider";

type ReadyImage = {
  readonly status: "ready";
  readonly width: number;
  readonly height: number;
  readonly name: string;
  readonly url: string;
};

type ImageState =
  | { readonly status: "empty" }
  | ReadyImage
  | { readonly status: "error"; readonly message: string };

type ReadyResult = {
  readonly status: "ready";
  readonly blob: Blob;
  readonly url: string;
  readonly downloadName: string;
};

type ResultState =
  | { readonly status: "idle" }
  | { readonly status: "processing" }
  | ReadyResult
  | { readonly status: "error"; readonly message: string };

type BrowserActions = typeof import("../../browser/actions");

let browserActionsPromise: Promise<BrowserActions> | undefined;

const loadBrowserActions = (): Promise<BrowserActions> => {
  browserActionsPromise ??= import("../../browser/actions");

  return browserActionsPromise;
};

const transparentName = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf(".");
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;

  return `${baseName || "image"}-transparent.png`;
};

export const HomePage = (props: { readonly showIntro?: boolean }) => {
  const [imageState, setImageState] = createSignal<ImageState>({ status: "empty" });
  const [resultState, setResultState] = createSignal<ResultState>({ status: "idle" });
  const [copyState, setCopyState] = createSignal<"idle" | "copied" | "error">("idle");
  let fileInput: HTMLInputElement | undefined;
  let downloadLink: HTMLAnchorElement | undefined;
  let activeSourceFile: File | undefined;
  let activeSourceUrl: string | undefined;
  let activeResultUrl: string | undefined;
  let selectionVersion = 0;

  const readyImage = (): ReadyImage | undefined => {
    const state = imageState();

    return state.status === "ready" ? state : undefined;
  };

  const imageError = (): string | undefined => {
    const state = imageState();

    return state.status === "error" ? state.message : undefined;
  };

  const readyResult = (): ReadyResult | undefined => {
    const state = resultState();

    return state.status === "ready" ? state : undefined;
  };

  const resultError = (): string | undefined => {
    const state = resultState();

    return state.status === "error" ? state.message : undefined;
  };

  const processing = (): boolean => resultState().status === "processing";

  const clearResult = () => {
    if (activeResultUrl !== undefined) {
      URL.revokeObjectURL(activeResultUrl);
      activeResultUrl = undefined;
    }

    setResultState({ status: "idle" });
    setCopyState("idle");
  };

  const reset = () => {
    selectionVersion += 1;
    clearResult();

    if (activeSourceUrl !== undefined) {
      URL.revokeObjectURL(activeSourceUrl);
      activeSourceUrl = undefined;
    }

    activeSourceFile = undefined;
    setImageState({ status: "empty" });

    if (fileInput !== undefined) {
      fileInput.value = "";
    }
  };

  const runRemoval = (file: File, version: number) => {
    setResultState({ status: "processing" });

    void loadBrowserActions()
      .then((actions) => actions.removeBrowserBackground(file))
      .then((outcome) => {
        if (version !== selectionVersion) {
          return;
        }

        if (!outcome.ok) {
          setResultState({ status: "error", message: outcome.message });

          return;
        }

        activeResultUrl = URL.createObjectURL(outcome.result.blob);
        setResultState({
          status: "ready",
          blob: outcome.result.blob,
          url: activeResultUrl,
          downloadName: transparentName(file.name),
        });
      })
      .catch(() => {
        if (version === selectionVersion) {
          setResultState({
            status: "error",
            message: "Background removal could not start in this browser.",
          });
        }
      });
  };

  const selectImage = (file: File) => {
    if (processing()) {
      return;
    }

    selectionVersion += 1;
    const version = selectionVersion;
    clearResult();
    setImageState({ status: "empty" });

    if (activeSourceUrl !== undefined) {
      URL.revokeObjectURL(activeSourceUrl);
      activeSourceUrl = undefined;
    }

    activeSourceFile = undefined;

    void loadBrowserActions()
      .then((actions) => actions.decodeBrowserImage(file))
      .then((outcome) => {
        if (version !== selectionVersion) {
          return;
        }

        if (!outcome.ok) {
          setImageState({ status: "error", message: outcome.message });

          return;
        }

        activeSourceUrl = URL.createObjectURL(file);
        activeSourceFile = file;
        setImageState({
          status: "ready",
          width: outcome.dimensions.width,
          height: outcome.dimensions.height,
          name: file.name,
          url: activeSourceUrl,
        });
        runRemoval(file, version);
      })
      .catch(() => {
        if (version === selectionVersion) {
          setImageState({
            status: "error",
            message: "This image could not be opened in the browser.",
          });
        }
      });
  };

  const copyResult = (result: ReadyResult) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      setCopyState("error");

      return;
    }

    void navigator.clipboard
      .write([new ClipboardItem({ "image/png": result.blob })])
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("error"));
  };

  const copyLabel = (): string => {
    const state = copyState();

    if (state === "copied") {
      return "Copied";
    }

    if (state === "error") {
      return "Copy failed";
    }

    return "Copy";
  };

  const redo = () => {
    if (activeSourceFile === undefined || processing()) {
      return;
    }

    clearResult();
    runRemoval(activeSourceFile, selectionVersion);
  };

  const chooseNewImage = () => {
    reset();
    fileInput?.click();
  };

  const handleSurfaceClick = (event: MouseEvent) => {
    if (readyImage() !== undefined || event.target !== event.currentTarget) {
      return;
    }

    fileInput?.click();
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();

    if (processing()) {
      return;
    }

    const file = event.dataTransfer?.files.item(0);

    if (file !== null && file !== undefined) {
      selectImage(file);
    }
  };

  const handleFileInput = (event: Event) => {
    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.item(0);

    if (file !== null && file !== undefined) {
      selectImage(file);
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (processing()) {
      return;
    }

    const clipboardItems = event.clipboardData?.items;

    if (clipboardItems === undefined) {
      return;
    }

    for (const item of Array.from(clipboardItems)) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) {
        continue;
      }

      const file = item.getAsFile();

      if (file !== null) {
        event.preventDefault();
        selectImage(file);

        return;
      }
    }
  };

  const handleKeyboardShortcut = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();

    if ((event.metaKey || event.ctrlKey) && key === "o" && !processing()) {
      event.preventDefault();
      chooseNewImage();

      return;
    }

    if (event.metaKey || event.ctrlKey) {
      return;
    }

    const target = event.target;

    if (
      target instanceof HTMLElement &&
      (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
    ) {
      return;
    }

    if (key === "n" && !processing()) {
      event.preventDefault();
      chooseNewImage();

      return;
    }

    const result = readyResult();

    if (result === undefined) {
      return;
    }

    if (key === "c") {
      event.preventDefault();
      copyResult(result);

      return;
    }

    if (key === "d") {
      event.preventDefault();
      downloadLink?.click();

      return;
    }

    if (key === "r" && !processing()) {
      event.preventDefault();
      redo();
    }
  };

  onSettled(() => {
    window.addEventListener("keydown", handleKeyboardShortcut);
    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("keydown", handleKeyboardShortcut);
      window.removeEventListener("paste", handlePaste);
      selectionVersion += 1;

      if (activeSourceUrl !== undefined) {
        URL.revokeObjectURL(activeSourceUrl);
      }

      if (activeResultUrl !== undefined) {
        URL.revokeObjectURL(activeResultUrl);
      }

      activeSourceFile = undefined;
    };
  });

  return (
    <main class="page-content home-shell">
      <Show when={props.showIntro}>
        <div class="home-intro">
          <p>
            Free, private background remover for PNG, JPEG, WebP, and AVIF. Processing runs in
            your browser with WebGPU when available, and your images stay on your device.
          </p>
        </div>
      </Show>

      <section
        class={`drop-surface${readyImage() !== undefined ? " has-image" : ""}`}
        onClick={handleSurfaceClick}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          ref={(element) => {
            fileInput = element;
          }}
          id="source-file-input"
          class="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          aria-label="Choose image"
          onChange={handleFileInput}
        />

        <Show
          keyed
          when={readyImage()}
          fallback={
            <button class="drop-trigger" type="button" onClick={() => fileInput?.click()}>
              <span class="drop-trigger-copy">
                <span class="drop-trigger-shortcuts" aria-label="Image input shortcuts">
                  <span aria-keyshortcuts="Meta+O Control+O">
                    <kbd class="shortcut-key input-shortcut-key" aria-label="Choose image shortcut, Command O">⌘O</kbd>
                  </span>
                </span>
                <strong>Click or drag image here</strong>
                <span class="drop-trigger-shortcuts" aria-label="Image input shortcuts">
                  <span aria-keyshortcuts="Meta+V Control+V">
                    or paste <kbd class="shortcut-key input-shortcut-key" aria-label="Paste image shortcut, Command V">⌘V</kbd>
                  </span>
                  <span class="drop-trigger-format">JPEG, PNG, WebP, or AVIF</span>
                </span>
              </span>
            </button>
          }
        >
          {(image) => (
            <div class="result-flow">
              <Show
                keyed
                when={readyResult()}
                fallback={
                  <div
                    class="image-stage"
                    style={`--image-aspect-ratio: ${image.width} / ${image.height};`}
                  >
                    <img class="preview-image" src={image.url} alt={image.name} />
                    <Show when={processing()}>
                      <div class="processing-label" role="status">Removing background...</div>
                    </Show>
                  </div>
                }
              >
                {(result) => (
                  <ComparisonSlider
                    leftSrc={image.url}
                    rightSrc={result.url}
                    leftAlt={`Original ${image.name}`}
                    rightAlt={`${image.name} with background removed`}
                    aspectRatio={`${image.width} / ${image.height}`}
                  />
                )}
              </Show>

              <Show keyed when={resultError()}>
                {(message) => <div class="error-card">{message}</div>}
              </Show>

              <div class="result-actions">
                <button
                  class="text-button"
                  type="button"
                  disabled={processing()}
                  aria-keyshortcuts="N"
                  title="New image (N)"
                  onClick={chooseNewImage}
                >
                  <span>New Image</span>
                  <kbd class="shortcut-key" aria-hidden="true">N</kbd>
                </button>
                <Show keyed when={readyResult()}>
                  {(result) => (
                    <div class="result-action-group">
                      <button
                        class="text-button"
                        type="button"
                        aria-keyshortcuts="C"
                        title="Copy result (C)"
                        onClick={() => copyResult(result)}
                      >
                        <span>{copyLabel()}</span>
                        <kbd class="shortcut-key" aria-hidden="true">C</kbd>
                      </button>
                      <a
                        ref={(element) => {
                          downloadLink = element;
                        }}
                        class="download-button"
                        href={result.url}
                        download={result.downloadName}
                        aria-keyshortcuts="D"
                        title="Download result (D)"
                      >
                        <span>Download</span>
                        <kbd class="shortcut-key shortcut-key-inverted" aria-hidden="true">D</kbd>
                      </a>
                      <button
                        class="text-button"
                        type="button"
                        aria-keyshortcuts="R"
                        title="Redo removal (R)"
                        onClick={redo}
                      >
                        <span>Redo</span>
                        <kbd class="shortcut-key" aria-hidden="true">R</kbd>
                      </button>
                    </div>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>

        <Show keyed when={imageError()}>
          {(message) => (
            <div class="empty-error">
              <div class="error-card">{message}</div>
              <button class="text-button" type="button" onClick={() => fileInput?.click()}>
                Choose another image
              </button>
            </div>
          )}
        </Show>
      </section>
    </main>
  );
};
