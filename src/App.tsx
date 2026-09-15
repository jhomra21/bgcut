import { Effect } from "effect";
import { Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";

import { formatBackgroundRemovalError, formatGpuRuntimeError, formatImageError } from "./engine/errors";
import { removeBackground } from "./engine/inference";
import { decodeImage } from "./engine/image";
import { checkGpuCapability, type GpuCapability } from "./engine/runtime";

type GpuState =
  | { readonly status: "checking" }
  | { readonly status: "ready"; readonly capability: GpuCapability }
  | { readonly status: "error"; readonly message: string };

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
  readonly width: number;
  readonly height: number;
  readonly modelRevision: string;
};

type ResultState =
  | { readonly status: "idle" }
  | { readonly status: "processing" }
  | ReadyResult
  | { readonly status: "error"; readonly message: string };

type RuntimeCheckProps = {
  readonly label: string;
  readonly passed: boolean;
};

const transparentName = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf(".");
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  return `${baseName || "image"}-transparent.png`;
};

const App = () => {
  const [gpuState, setGpuState] = createSignal<GpuState>({ status: "checking" });
  const [imageState, setImageState] = createSignal<ImageState>({ status: "empty" });
  const [resultState, setResultState] = createSignal<ResultState>({ status: "idle" });
  const [selectedFile, setSelectedFile] = createSignal<File>();
  let fileInput: HTMLInputElement | undefined;
  let activeSourceUrl: string | undefined;
  let activeResultUrl: string | undefined;
  let selectionVersion = 0;

  const readyGpu = (): GpuCapability | undefined => {
    const state = gpuState();
    return state.status === "ready" ? state.capability : undefined;
  };

  const gpuError = (): string | undefined => {
    const state = gpuState();
    return state.status === "error" ? state.message : undefined;
  };

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

  const initializeGpu = () => {
    setGpuState({ status: "checking" });

    void Effect.runPromise(
      checkGpuCapability.pipe(
        Effect.match({
          onFailure: (error) => setGpuState({ status: "error", message: formatGpuRuntimeError(error) }),
          onSuccess: (capability) => setGpuState({ status: "ready", capability }),
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
              width: result.width,
              height: result.height,
              modelRevision: result.modelRevision,
            });
          },
        }),
      ),
    );
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
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

  onSettled(() => {
    initializeGpu();

    return () => {
      selectionVersion += 1;
      if (activeSourceUrl !== undefined) {
        URL.revokeObjectURL(activeSourceUrl);
      }
      if (activeResultUrl !== undefined) {
        URL.revokeObjectURL(activeResultUrl);
      }
    };
  });

  return (
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">LOCAL IMAGE TOOL</p>
          <h1>removebg-webgpu</h1>
        </div>
        <div class="privacy-pill">Runs in your browser</div>
      </header>

      <section class="workspace">
        <div
          class="drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onClick={() => {
            if (!processing()) {
              fileInput?.click();
            }
          }}
          role="button"
          tabindex={0}
          onKeyDown={(event) => {
            if (!processing() && (event.key === "Enter" || event.key === " ")) {
              fileInput?.click();
            }
          }}
        >
          <input
            ref={(element) => {
              fileInput = element;
            }}
            class="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileInput}
          />

          <Show keyed when={readyImage()} fallback={<DropCopy />}>
            {(image) => (
              <div class="preview-wrap" onClick={(event) => event.stopPropagation()}>
                <Show
                  keyed
                  when={readyResult()}
                  fallback={
                    <figure class="image-card">
                      <div class="image-stage checkerboard">
                        <img class="preview" src={image.url} alt={image.name} />
                      </div>
                      <figcaption>Original</figcaption>
                    </figure>
                  }
                >
                  {(result) => (
                    <div class="comparison-grid">
                      <figure class="image-card">
                        <div class="image-stage checkerboard">
                          <img class="preview" src={image.url} alt={`Original ${image.name}`} />
                        </div>
                        <figcaption>Original</figcaption>
                      </figure>
                      <figure class="image-card">
                        <div class="image-stage checkerboard">
                          <img class="preview" src={result.url} alt={`${image.name} with background removed`} />
                        </div>
                        <figcaption>Transparent</figcaption>
                      </figure>
                    </div>
                  )}
                </Show>

                <div class="image-meta">
                  <span>{image.name}</span>
                  <span>{image.width} × {image.height}</span>
                </div>

                <div class="image-actions">
                  <button class="ghost-button" type="button" disabled={processing()} onClick={() => fileInput?.click()}>
                    Change image
                  </button>
                  <button
                    class="primary-button"
                    type="button"
                    disabled={processing() || readyGpu() === undefined}
                    onClick={runRemoval}
                  >
                    {processing() ? "Removing…" : readyResult() === undefined ? "Remove background" : "Run again"}
                  </button>
                  <Show keyed when={readyResult()}>
                    {(result) => (
                      <a class="download-button" href={result.url} download={result.downloadName}>
                        Download PNG
                      </a>
                    )}
                  </Show>
                </div>

                <Show when={processing()}>
                  <div class="processing-card">
                    <div class="activity-bar" />
                    <div>
                      <strong>Running BiRefNet locally</strong>
                      <p>The first run downloads the pinned fp32 model (~183 MB). Later runs can use the browser cache.</p>
                    </div>
                  </div>
                </Show>

                <Show keyed when={resultError()}>
                  {(message) => <div class="error-card result-error">{message}</div>}
                </Show>
              </div>
            )}
          </Show>
        </div>

        <aside class="diagnostics">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">RUNTIME</p>
              <h2>GPU foundation</h2>
            </div>
            <button class="ghost-button" type="button" disabled={processing()} onClick={initializeGpu}>Retry</button>
          </div>

          <Show
            keyed
            when={readyGpu()}
            fallback={
              <Show keyed when={gpuError()} fallback={<p class="status-copy">Requesting a WebGPU device…</p>}>
                {(message) => <div class="error-card">{message}</div>}
              </Show>
            }
          >
            {(capability) => (
              <div class="checks">
                <RuntimeCheck label="WebGPU device" passed={capability.webGpu} />
                <RuntimeCheck label="ONNX Runtime WebGPU" passed={capability.ortWebGpu} />
                <RuntimeCheck label="TypeGPU root" passed={capability.typeGpu} />
                <RuntimeCheck label="ORT shares device" passed={capability.ortUsesSharedDevice} />
                <RuntimeCheck label="TypeGPU shares device" passed={capability.typeGpuUsesSharedDevice} />
              </div>
            )}
          </Show>

          <div class="model-card">
            <p class="eyebrow">MODEL</p>
            <strong>BiRefNet Lite · 512 · fp32</strong>
            <span>Pinned revision 4a3c40c</span>
            <span>Inference at 512² · export at source resolution</span>
          </div>

          <Show keyed when={readyResult()}>
            {(result) => (
              <div class="success-card">
                <strong>Transparent PNG ready</strong>
                <span>{result.width} × {result.height}</span>
              </div>
            )}
          </Show>

          <div class="milestone-note">
            The first cut keeps preprocessing and compositing on Canvas 2D for reliability. TypeGPU already shares the inference device; mask refinement and GPU-native image stages move there next.
          </div>
        </aside>
      </section>

      <Show keyed when={imageError()}>
        {(message) => <div class="global-error">{message}</div>}
      </Show>
    </main>
  );
};

const DropCopy = () => (
  <div class="drop-copy">
    <div class="drop-icon" aria-hidden="true">↗</div>
    <h2>Drop an image</h2>
    <p>PNG, JPEG, or WebP. Inference and image processing stay in this browser.</p>
    <button class="primary-button" type="button">Choose image</button>
  </div>
);

const RuntimeCheck = (props: RuntimeCheckProps) => (
  <div class="runtime-check">
    <span class={props.passed ? "check-dot passed" : "check-dot failed"} />
    <span>{props.label}</span>
    <strong>{props.passed ? "ready" : "failed"}</strong>
  </div>
);

export default App;
