import { Effect } from "effect";
import { Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";

import ComparisonSlider from "./components/ComparisonSlider";
import { formatBackgroundRemovalError, formatImageError } from "./engine/errors";
import { removeBackground } from "./engine/inference";
import { decodeImage } from "./engine/image";

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

const transparentName = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf(".");
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;

  return `${baseName || "image"}-transparent.png`;
};

const App = () => {
  const [imageState, setImageState] = createSignal<ImageState>({ status: "empty" });
  const [resultState, setResultState] = createSignal<ResultState>({ status: "idle" });
  const [copyState, setCopyState] = createSignal<"idle" | "copied" | "error">("idle");
  let fileInput: HTMLInputElement | undefined;
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

    void Effect.runPromise(
      removeBackground(file).pipe(
        Effect.match({
          onFailure: (error) => {
            if (version === selectionVersion) {
              setResultState({ status: "error", message: formatBackgroundRemovalError(error) });
            }
          },
          onSuccess: (result) => {
            if (version !== selectionVersion) {
              return;
            }

            activeResultUrl = URL.createObjectURL(result.blob);
            setResultState({
              status: "ready",
              blob: result.blob,
              url: activeResultUrl,
              downloadName: transparentName(file.name),
            });
          },
        }),
      ),
    );
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

    void Effect.runPromise(
      decodeImage(file).pipe(
        Effect.match({
          onFailure: (error) => {
            if (version === selectionVersion) {
              setImageState({ status: "error", message: formatImageError(error) });
            }
          },
          onSuccess: (dimensions) => {
            if (version !== selectionVersion) {
              return;
            }

            activeSourceUrl = URL.createObjectURL(file);
            activeSourceFile = file;
            setImageState({
              status: "ready",
              width: dimensions.width,
              height: dimensions.height,
              name: file.name,
              url: activeSourceUrl,
            });
            runRemoval(file, version);
          },
        }),
      ),
    );
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

  onSettled(() => () => {
    selectionVersion += 1;

    if (activeSourceUrl !== undefined) {
      URL.revokeObjectURL(activeSourceUrl);
    }

    if (activeResultUrl !== undefined) {
      URL.revokeObjectURL(activeResultUrl);
    }

    activeSourceFile = undefined;
  });

  return (
    <main class="app-shell">
      <header class="app-header">
        <h1 class="brand-title" aria-label="bgcut">
          <img
            class="brand-logo"
            src="/bgcut-logo.png"
            alt=""
            width="1200"
            height="346"
            aria-hidden="true"
          />
        </h1>
        <a href="https://github.com/jhomra21/bgcut" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

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
              Click or drag image here
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
                  onClick={chooseNewImage}
                >
                  New Image
                </button>
                <Show keyed when={readyResult()}>
                  {(result) => (
                    <div class="result-action-group">
                      <button class="text-button" type="button" onClick={() => copyResult(result)}>
                        {copyLabel()}
                      </button>
                      <a class="download-button" href={result.url} download={result.downloadName}>
                        Download
                      </a>
                      <button class="text-button" type="button" onClick={redo}>
                        Redo
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

export default App;
