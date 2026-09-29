import { Show, createSignal } from "solid-js";

type TransparencyResult = {
  readonly width: number;
  readonly height: number;
  readonly totalPixels: number;
  readonly transparentPixels: number;
  readonly partialPixels: number;
  readonly opaquePixels: number;
  readonly hasTransparency: boolean;
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
};

type CheckerState =
  | { readonly status: "empty" }
  | { readonly status: "checking" }
  | { readonly status: "ready"; readonly result: TransparencyResult }
  | { readonly status: "error"; readonly message: string };

const percent = (count: number, total: number): string =>
  total === 0 ? "0%" : `${((count / total) * 100).toFixed(2)}%`;

const fileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const inspectTransparency = async (file: File): Promise<TransparencyResult> => {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (context === null) {
      throw new Error("This browser could not open an image canvas.");
    }

    context.drawImage(bitmap, 0, 0);

    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let transparentPixels = 0;
    let partialPixels = 0;
    let opaquePixels = 0;

    for (let offset = 3; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset];

      if (alpha === 0) {
        transparentPixels += 1;
      } else if (alpha === 255) {
        opaquePixels += 1;
      } else {
        partialPixels += 1;
      }
    }

    const totalPixels = bitmap.width * bitmap.height;

    return {
      width: bitmap.width,
      height: bitmap.height,
      totalPixels,
      transparentPixels,
      partialPixels,
      opaquePixels,
      hasTransparency: transparentPixels + partialPixels > 0,
      fileName: file.name,
      fileType: file.type || "Unknown",
      fileSize: file.size,
    };
  } finally {
    bitmap.close();
  }
};

export const ToolIndexPage = () => (
  <main class="page-content legal-shell">
    <article class="guide-page tool-index">
      <p class="guide-kicker">Tools</p>
      <h1>Free image tools</h1>
      <p class="guide-summary">
        Small local utilities for checking image files before or after background removal.
      </p>

      <div class="guide-list">
        <a href="/tools/transparency-checker">
          <strong>Image transparency checker</strong>
          <span>Find fully transparent, partially transparent, and opaque pixels without uploading the image.</span>
        </a>
      </div>
    </article>
  </main>
);

export const TransparencyCheckerPage = () => {
  const [state, setState] = createSignal<CheckerState>({ status: "empty" });

  const errorMessage = (): string | undefined => {
    const current = state();

    return current.status === "error" ? current.message : undefined;
  };

  const readyResult = (): TransparencyResult | undefined => {
    const current = state();

    return current.status === "ready" ? current.result : undefined;
  };

  let fileInput: HTMLInputElement | undefined;

  const check = (file: File) => {
    setState({ status: "checking" });

    void inspectTransparency(file)
      .then((result) => setState({ status: "ready", result }))
      .catch(() => {
        setState({
          status: "error",
          message: "This browser could not decode the selected image.",
        });
      });
  };

  const handleInput = (event: Event) => {
    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.item(0);

    if (file !== null && file !== undefined) {
      check(file);
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer?.files.item(0);

    if (file !== null && file !== undefined) {
      check(file);
    }
  };

  return (
    <main class="page-content legal-shell">
      <article class="guide-page tool-page">
        <p class="guide-kicker"><a href="/tools">Tools</a></p>
        <h1>Image transparency checker</h1>
        <p class="guide-summary">
          Check whether an image contains transparent or partially transparent pixels. The file is
          decoded and inspected in your browser. It is not uploaded to bgcut.
        </p>

        <section>
          <h2>Check an image</h2>
          <input
            ref={(element) => {
              fileInput = element;
            }}
            class="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            aria-label="Choose image to inspect"
            onChange={handleInput}
          />

          <button
            class="tool-drop"
            type="button"
            onClick={() => fileInput?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <strong>Choose or drop an image</strong>
            <span>PNG, JPEG, WebP, or AVIF</span>
          </button>

          <Show when={state().status === "checking"}>
            <p class="tool-status" role="status">Checking pixels...</p>
          </Show>

          <Show keyed when={errorMessage()}>
            {(message) => (
              <p class="tool-status tool-status-error" role="alert">{message}</p>
            )}
          </Show>

          <Show keyed when={readyResult()}>
            {(result) => (
                <div class="tool-result" aria-live="polite">
                  <div class="tool-result-head">
                    <strong>{result.hasTransparency ? "Transparency found" : "No transparent pixels found"}</strong>
                    <span>{result.fileName}</span>
                  </div>
                  <dl class="tool-stats">
                    <div><dt>Dimensions</dt><dd>{result.width} x {result.height}</dd></div>
                    <div><dt>File type</dt><dd>{result.fileType}</dd></div>
                    <div><dt>File size</dt><dd>{fileSize(result.fileSize)}</dd></div>
                    <div><dt>Fully transparent</dt><dd>{result.transparentPixels.toLocaleString()} ({percent(result.transparentPixels, result.totalPixels)})</dd></div>
                    <div><dt>Partially transparent</dt><dd>{result.partialPixels.toLocaleString()} ({percent(result.partialPixels, result.totalPixels)})</dd></div>
                    <div><dt>Opaque</dt><dd>{result.opaquePixels.toLocaleString()} ({percent(result.opaquePixels, result.totalPixels)})</dd></div>
                  </dl>
                </div>
            )}
          </Show>
        </section>

        <section>
          <h2>What the result means</h2>
          <p>
            A fully transparent pixel has alpha 0. A partially transparent pixel has alpha between
            1 and 254. An opaque pixel has alpha 255.
          </p>
          <p>
            PNG and WebP can store alpha transparency. JPEG cannot. AVIF can contain alpha when the
            encoded image includes it.
          </p>
        </section>

        <section>
          <h2>Why check transparency</h2>
          <p>
            A checker can confirm that a cutout really contains alpha instead of a white or
            checkerboard background baked into the pixels. It can also reveal soft edge pixels
            around hair, fur, and anti-aliased shapes.
          </p>
          <p>
            If you need to create a transparent cutout first, use the <a href="/">bgcut background remover</a>.
          </p>
        </section>
      </article>
    </main>
  );
};
