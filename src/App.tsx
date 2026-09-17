import { Effect } from "effect";
import { Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";

import ComparisonSlider from "./components/ComparisonSlider";
import { formatBackgroundRemovalError, formatImageError } from "./engine/errors";
import { removeBackground } from "./engine/inference";
import { decodeImage } from "./engine/image";

type ReadyImage = {
  readonly status: "ready";
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly url: string;
};

type ImageState =
  | { readonly status: "empty" }
  | ReadyImage
  | { readonly status: "error"; readonly message: string };

type ReadyResult = {
  readonly status: "ready";
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
  const [selectedFile, setSelectedFile] = createSignal<File>();
  let fileInput: HTMLInputElement | undefined;
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
  };

  const selectImage = (file: File) => {
    if (processing()) {
      return;
    }

    selectionVersion += 1;
    const version = selectionVersion;
    clearResult();
    setSelectedFile(undefined);
    setImageState({ status: "empty" });

    if (activeSourceUrl !== undefined) {
      URL.revokeObjectURL(activeSourceUrl);
      activeSourceUrl = undefined;
    }

    void Effect.runPromise(
      decodeImage(file).pipe(
        Effect.match({
          onFailure: (error) => {
            if (version === selectionVersion) {
              setSelectedFile(undefined);
              setImageState({ status: "error", message: formatImageError(error) });
            }
          },
          onSuccess: (decoded) => {
            if (version !== selectionVersion) {
              return;
            }

            activeSourceUrl = URL.createObjectURL(file);
            setSelectedFile(file);
            setImageState({
              status: "ready",
              name: file.name,
              width: decoded.width,
              height: decoded.height,
              url: activeSourceUrl,
            });
          },
        }),
      ),
    );
  };

  const runRemoval = () => {
    const file = selectedFile();

    if (file === undefined || processing()) {
      return;
    }

    const version = selectionVersion;
    clearResult();
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
              url: activeResultUrl,
              downloadName: transparentName(file.name),
            });
          },
        }),
      ),
    );
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
      input.value = "";
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
  });

  return (
    <main class="app-shell">
      <header class="app-header">
        <h1>bgcut</h1>
        <span>Local background removal</span>
      </header>

      <section
        class="tool-card"
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
            <div class="empty-state">
              <h2>Drop an image</h2>
              <p>JPEG, PNG, WebP, or AVIF</p>
              <button class="primary-button" type="button" onClick={() => fileInput?.click()}>
                Choose image
              </button>
            </div>
          }
        >
          {(image) => (
            <div class="image-flow">
              <Show
                keyed
                when={readyResult()}
                fallback={
                  <div class="image-stage checkerboard">
                    <img class="preview-image" src={image.url} alt={image.name} />
                  </div>
                }
              >
                {(result) => (
                  <ComparisonSlider
                    leftSrc={image.url}
                    rightSrc={result.url}
                    leftAlt={`Original ${image.name}`}
                    rightAlt={`${image.name} with background removed`}
                    leftLabel="Original"
                    rightLabel="Result"
                  />
                )}
              </Show>

              <div class="image-meta">
                <span class="image-name">{image.name}</span>
                <span>{image.width} x {image.height}</span>
              </div>

              <Show when={processing()}>
                <div class="progress-row" role="status">Removing background...</div>
              </Show>

              <Show keyed when={resultError()}>
                {(message) => <div class="error-card">{message}</div>}
              </Show>

              <div class="image-actions">
                <button class="secondary-button" type="button" disabled={processing()} onClick={() => fileInput?.click()}>
                  Change image
                </button>

                <Show
                  keyed
                  when={readyResult()}
                  fallback={
                    <button class="primary-button" type="button" disabled={processing()} onClick={runRemoval}>
                      {processing() ? "Removing..." : "Remove background"}
                    </button>
                  }
                >
                  {(result) => (
                    <a class="primary-button download-button" href={result.url} download={result.downloadName}>
                      Download PNG
                    </a>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>

        <Show keyed when={imageError()}>
          {(message) => <div class="error-card empty-error">{message}</div>}
        </Show>
      </section>

      <p class="privacy-note">Images stay on this device.</p>
    </main>
  );
};

export default App;
