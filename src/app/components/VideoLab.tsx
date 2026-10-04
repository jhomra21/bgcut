import {
  Show,
  createSignal,
  onCleanup,
} from "solid-js";

type VideoModule =
  typeof import(
    "../../browser/video-experimental"
  );

type VideoState =
  | {
      readonly status:
        "empty";
    }
  | {
      readonly status:
        "processing";
      readonly fileName:
        string;
      readonly message:
        string;
      readonly progress:
        number;
    }
  | {
      readonly status:
        "ready";
      readonly fileName:
        string;
      readonly url:
        string;
      readonly downloadName:
        string;
      readonly width:
        number;
      readonly height:
        number;
      readonly frameCount:
        number;
      readonly duration:
        number;
      readonly sampleFps:
        number;
      readonly seed:
        "birefnet-direct" |
        "edgetam-grid";
    }
  | {
      readonly status:
        "error";
      readonly message:
        string;
    };

let modulePromise:
  Promise<VideoModule> |
  undefined;

const loadVideoModule =
  (): Promise<VideoModule> => {
    modulePromise ??=
      import(
        "../../browser/video-experimental"
      );

    return modulePromise;
  };

const transparentName = (
  fileName: string,
): string => {
  const lastDot =
    fileName.lastIndexOf(
      ".",
    );

  const base =
    lastDot >
    0
      ? fileName.slice(
          0,
          lastDot,
        )
      : fileName;

  return `${base || "video"}-transparent.webm`;
};

export const VideoLab = () => {
  const [
    state,
    setState,
  ] =
    createSignal<VideoState>({
      status: "empty",
    });

  let input:
    HTMLInputElement |
    undefined;

  let preview:
    HTMLCanvasElement |
    undefined;

  let activeUrl:
    string |
    undefined;

  let version = 0;

  const clearUrl = () => {
    if (
      activeUrl !==
      undefined
    ) {
      URL.revokeObjectURL(
        activeUrl,
      );

      activeUrl =
        undefined;
    }
  };

  const ready = () => {
    const current =
      state();

    return current.status ===
      "ready"
      ? current
      : undefined;
  };

  const processingState =
    () => {
      const current =
        state();

      return current.status ===
        "processing"
        ? current
        : undefined;
    };

  const errorMessage =
    () => {
      const current =
        state();

      return current.status ===
        "error"
        ? current.message
        : undefined;
    };

  const processing =
    () =>
      processingState() !==
      undefined;

  const run = (
    file: File,
  ) => {
    if (
      processing()
    ) {
      return;
    }

    version += 1;

    const runVersion =
      version;

    clearUrl();

    setState({
      status:
        "processing",
      fileName:
        file.name,
      message:
        "Preparing local video removal…",
      progress: 0,
    });

    void loadVideoModule()
      .then(
        (video) =>
          video.removeVideoBackgroundExperimental(
            file,
            {
              onProgress:
                (
                  update,
                ) => {
                  if (
                    version !==
                    runVersion
                  ) {
                    return;
                  }

                  setState({
                    status:
                      "processing",
                    fileName:
                      file.name,
                    message:
                      update.message,
                    progress:
                      update.progress,
                  });
                },
              onFrame:
                (
                  canvas,
                ) => {
                  if (
                    version !==
                      runVersion ||
                    preview ===
                      undefined
                  ) {
                    return;
                  }

                  if (
                    preview.width !==
                      canvas.width ||
                    preview.height !==
                      canvas.height
                  ) {
                    preview.width =
                      canvas.width;

                    preview.height =
                      canvas.height;
                  }

                  preview
                    .getContext(
                      "2d",
                    )
                    ?.drawImage(
                      canvas,
                      0,
                      0,
                    );
                },
            },
          ),
      )
      .then(
        (result) => {
          if (
            version !==
            runVersion
          ) {
            return;
          }

          activeUrl =
            URL.createObjectURL(
              result.blob,
            );

          setState({
            status:
              "ready",
            fileName:
              file.name,
            url:
              activeUrl,
            downloadName:
              transparentName(
                file.name,
              ),
            width:
              result.width,
            height:
              result.height,
            frameCount:
              result.frameCount,
            duration:
              result.duration,
            sampleFps:
              result.sampleFps,
            seed:
              result.seed,
          });
        },
      )
      .catch(
        (error) => {
          if (
            version !==
            runVersion
          ) {
            return;
          }

          setState({
            status:
              "error",
            message:
              error instanceof
              Error
                ? error.message
                : String(
                    error,
                  ),
          });
        },
      );
  };

  const handleInput = (
    event: Event,
  ) => {
    const target =
      event.currentTarget;

    if (
      !(
        target instanceof
        HTMLInputElement
      )
    ) {
      return;
    }

    const file =
      target.files?.item(
        0,
      );

    if (
      file !==
        null &&
      file !==
        undefined
    ) {
      run(
        file,
      );
    }
  };

  const handleDrop = (
    event: DragEvent,
  ) => {
    event.preventDefault();

    const file =
      event.dataTransfer
        ?.files.item(
          0,
        );

    if (
      file !==
        null &&
      file !==
        undefined
    ) {
      run(
        file,
      );
    }
  };

  onCleanup(
    () => {
      version += 1;
      clearUrl();
    },
  );

  return (
    <section
      class="video-lab"
      aria-labelledby="video-lab-title"
    >
      <div class="video-lab-head">
        <div>
          <span class="video-lab-kicker">
            Local experiment
          </span>
          <h2 id="video-lab-title">
            Video background removal
          </h2>
        </div>
        <span class="video-lab-meta">
          First 15s · 6 fps · silent WebM
        </span>
      </div>

      <p class="video-lab-copy">
        Uses fp16 BiRefNet for semantic foreground discovery, EdgeTAM for temporal tracking, and MediaBunny for local decoding and transparent VP9/WebM export.
      </p>

      <input
        ref={(element) => {
          input =
            element;
        }}
        class="file-input"
        type="file"
        accept="video/*"
        aria-label="Choose video"
        onChange={
          handleInput
        }
      />

      <button
        class="video-lab-drop"
        type="button"
        disabled={
          processing()
        }
        onClick={() =>
          input?.click()
        }
        onDragOver={(
          event,
        ) =>
          event.preventDefault()
        }
        onDrop={
          handleDrop
        }
      >
        <strong>
          {processing()
            ? "Processing locally…"
            : "Choose or drop a short video"}
        </strong>
        <span>
          Nothing is uploaded.
        </span>
      </button>

      <Show
        keyed
        when={
          processingState()
        }
      >
        {(current) => (
          <div class="video-lab-progress">
            <progress
              max="1"
              value={
                current.progress
              }
            />
            <span>
              {current.message}
            </span>
          </div>
        )}
      </Show>

      <Show
        when={
          state().status !==
          "empty"
        }
      >
        <div class="video-lab-preview checkerboard">
          <canvas
            ref={(element) => {
              preview =
                element;
            }}
          />
        </div>
      </Show>

      <Show
        keyed
        when={ready()}
      >
        {(result) => (
          <div class="video-lab-result">
            <video
              class="video-lab-video checkerboard"
              src={result.url}
              controls
              loop
              playsinline
            />
            <div class="video-lab-result-row">
              <span>
                {result.width}×{result.height} · {result.frameCount} frames · {result.sampleFps} fps · seed {result.seed}
              </span>
              <a
                class="download-button"
                href={
                  result.url
                }
                download={
                  result.downloadName
                }
              >
                Download WebM
              </a>
            </div>
          </div>
        )}
      </Show>

      <Show
        keyed
        when={
          errorMessage()
        }
      >
        {(message) => (
          <div
            class="error-card"
            role="alert"
          >
            {message}
          </div>
        )}
      </Show>
    </section>
  );
};
