import {
  For,
  Show,
  createSignal,
  onCleanup,
} from "solid-js";

type VideoModule =
  typeof import(
    "../../browser/video-experimental"
  );

type PromptMode =
  | "keep"
  | "exclude";

type PromptPoint = {
  readonly x: number;
  readonly y: number;
  readonly label: 0 | 1;
};

type VideoState =
  | {
      readonly status:
        "empty";
    }
  | {
      readonly status:
        "selecting";
      readonly fileName:
        string;
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
        | "sam21-prompt"
        | "birefnet-direct"
        | "edgetam-grid";
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

const seedLabel = (
  seed:
    | "sam21-prompt"
    | "birefnet-direct"
    | "edgetam-grid",
): string => {
  switch (
    seed
  ) {
    case "sam21-prompt":
      return "selected subject";

    case "birefnet-direct":
      return "automatic subject";

    case "edgetam-grid":
      return "automatic fallback";
  }
};

export const VideoLab = () => {
  const [
    state,
    setState,
  ] =
    createSignal<VideoState>({
      status: "empty",
    });

  const [
    selectedFile,
    setSelectedFile,
  ] =
    createSignal<
      File |
      undefined
    >();

  const [
    selectionUrl,
    setSelectionUrl,
  ] =
    createSignal<
      string |
      undefined
    >();

  const [
    promptMode,
    setPromptMode,
  ] =
    createSignal<PromptMode>(
      "keep",
    );

  const [
    points,
    setPoints,
  ] =
    createSignal<
      readonly PromptPoint[]
    >([]);

  let input:
    HTMLInputElement |
    undefined;

  let selectionVideo:
    HTMLVideoElement |
    undefined;

  let preview:
    HTMLCanvasElement |
    undefined;

  let activeResultUrl:
    string |
    undefined;

  let version = 0;

  const clearResultUrl =
    () => {
      if (
        activeResultUrl !==
        undefined
      ) {
        URL.revokeObjectURL(
          activeResultUrl,
        );

        activeResultUrl =
          undefined;
      }
    };

  const clearSelectionUrl =
    () => {
      const url =
        selectionUrl();

      if (
        url !==
        undefined
      ) {
        URL.revokeObjectURL(
          url,
        );

        setSelectionUrl(
          undefined,
        );
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

  const selecting = () =>
    state().status ===
    "selecting";

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

  const positivePoints =
    () =>
      points().filter(
        (point) =>
          point.label ===
          1,
      ).length;

  const chooseFile = (
    file: File,
  ) => {
    version += 1;
    clearResultUrl();
    clearSelectionUrl();

    setSelectedFile(
      file,
    );

    setPoints(
      [],
    );

    setPromptMode(
      "keep",
    );

    setSelectionUrl(
      URL.createObjectURL(
        file,
      ),
    );

    setState({
      status:
        "selecting",
      fileName:
        file.name,
    });
  };

  const run = (
    prompt?:
      {
        readonly points:
          readonly PromptPoint[];
      },
  ) => {
    const file =
      selectedFile();

    if (
      file ===
      undefined ||
      processing()
    ) {
      return;
    }

    if (
      prompt !==
        undefined &&
      !prompt.points.some(
        (point) =>
          point.label ===
          1,
      )
    ) {
      setState({
        status:
          "error",
        message:
          "Click the subject you want to keep before removing the background.",
      });

      return;
    }

    version += 1;

    const runVersion =
      version;

    clearResultUrl();

    setState({
      status:
        "processing",
      fileName:
        file.name,
      message:
        prompt ===
        undefined
          ? "Finding a subject automatically…"
          : "Loading SAM 2.1 for your selected subject…",
      progress: 0,
    });

    void loadVideoModule()
      .then(
        (video) =>
          video.removeVideoBackgroundExperimental(
            file,
            {
              prompt,
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

                  const context =
                    preview.getContext(
                      "2d",
                    );

                  if (
                    context ===
                    null
                  ) {
                    return;
                  }

                  context.clearRect(
                    0,
                    0,
                    preview.width,
                    preview.height,
                  );

                  context.drawImage(
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

          activeResultUrl =
            URL.createObjectURL(
              result.blob,
            );

          setState({
            status:
              "ready",
            fileName:
              file.name,
            url:
              activeResultUrl,
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

  const editSelection =
    () => {
      const file =
        selectedFile();

      if (
        file ===
        undefined
      ) {
        return;
      }

      version += 1;
      clearResultUrl();

      setState({
        status:
          "selecting",
        fileName:
          file.name,
      });
    };

  const handleSelectionClick =
    (
      event:
        MouseEvent,
    ) => {
      const target =
        event.currentTarget;

      if (
        !(
          target instanceof
          HTMLElement
        )
      ) {
        return;
      }

      const bounds =
        target.getBoundingClientRect();

      if (
        bounds.width <=
          0 ||
        bounds.height <=
          0
      ) {
        return;
      }

      const x =
        Math.min(
          1,
          Math.max(
            0,
            (
              event.clientX -
              bounds.left
            ) /
              bounds.width,
          ),
        );

      const y =
        Math.min(
          1,
          Math.max(
            0,
            (
              event.clientY -
              bounds.top
            ) /
              bounds.height,
          ),
        );

      setPoints(
        (
          current,
        ) => [
          ...current,
          {
            x,
            y,
            label:
              promptMode() ===
              "keep"
                ? 1
                : 0,
          },
        ],
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
      chooseFile(
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
      chooseFile(
        file,
      );
    }
  };

  onCleanup(
    () => {
      version += 1;
      clearResultUrl();
      clearSelectionUrl();
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
        Choose the subject you want to keep, then SAM 2.1 tracks it through the video. You can still try automatic selection when a quick result matters more than precise control.
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

      <Show
        when={
          state().status ===
          "empty"
        }
      >
        <button
          class="video-lab-drop"
          type="button"
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
            Choose or drop a short video
          </strong>
          <span>
            Nothing is uploaded.
          </span>
        </button>
      </Show>

      <Show
        when={
          selecting()
        }
      >
        <div class="video-lab-selection">
          <div class="video-lab-selection-head">
            <div>
              <strong>
                Select what stays
              </strong>
              <span>
                Click the subject you want to keep. Add exclude points when background or nearby objects get included.
              </span>
            </div>
            <button
              class="text-button"
              type="button"
              onClick={() =>
                input?.click()
              }
            >
              Change video
            </button>
          </div>

          <div class="video-lab-selection-frame">
            <video
              ref={(element) => {
                selectionVideo =
                  element;
              }}
              src={
                selectionUrl()
              }
              muted
              playsinline
              preload="auto"
              onLoadedData={() => {
                selectionVideo?.pause();

                if (
                  selectionVideo !==
                    undefined &&
                  selectionVideo.currentTime !==
                    0
                ) {
                  selectionVideo.currentTime =
                    0;
                }
              }}
            />
            <button
              class="video-lab-selection-surface"
              type="button"
              aria-label="Add a selection point"
              onClick={
                handleSelectionClick
              }
            />
            <For each={points()}>
              {(point) => (
                <span
                  class={
                    point.label ===
                    1
                      ? "video-lab-point is-keep"
                      : "video-lab-point is-exclude"
                  }
                  style={{
                    left:
                      `${point.x * 100}%`,
                    top:
                      `${point.y * 100}%`,
                  }}
                  aria-hidden="true"
                >
                  {point.label ===
                  1
                    ? "+"
                    : "−"}
                </span>
              )}
            </For>
          </div>

          <div class="video-lab-selection-toolbar">
            <div
              class="video-lab-prompt-modes"
              role="group"
              aria-label="Selection point type"
            >
              <button
                class="text-button"
                classList={{
                  "is-active":
                    promptMode() ===
                    "keep",
                }}
                type="button"
                aria-pressed={
                  promptMode() ===
                  "keep"
                }
                onClick={() =>
                  setPromptMode(
                    "keep",
                  )
                }
              >
                Keep
              </button>
              <button
                class="text-button"
                classList={{
                  "is-active":
                    promptMode() ===
                    "exclude",
                }}
                type="button"
                aria-pressed={
                  promptMode() ===
                  "exclude"
                }
                onClick={() =>
                  setPromptMode(
                    "exclude",
                  )
                }
              >
                Exclude
              </button>
            </div>

            <div class="video-lab-selection-actions">
              <button
                class="text-button"
                type="button"
                disabled={
                  points().length ===
                  0
                }
                onClick={() =>
                  setPoints(
                    (
                      current,
                    ) =>
                      current.slice(
                        0,
                        -1,
                      ),
                  )
                }
              >
                Undo
              </button>
              <button
                class="text-button"
                type="button"
                disabled={
                  points().length ===
                  0
                }
                onClick={() =>
                  setPoints(
                    [],
                  )
                }
              >
                Clear
              </button>
            </div>
          </div>

          <div class="video-lab-selection-footer">
            <span>
              {positivePoints() ===
              0
                ? "Add at least one Keep point."
                : `${positivePoints()} keep point${positivePoints() === 1 ? "" : "s"} · ${points().length - positivePoints()} exclude`}
            </span>
            <div class="video-lab-selection-actions">
              <button
                class="text-button"
                type="button"
                onClick={() =>
                  run()
                }
              >
                Auto select
              </button>
              <button
                class="download-button"
                type="button"
                disabled={
                  positivePoints() ===
                  0
                }
                onClick={() =>
                  run({
                    points:
                      points(),
                  })
                }
              >
                Remove background
              </button>
            </div>
          </div>
        </div>
      </Show>

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
          processing() ||
          state().status ===
            "ready"
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
                {result.width}×{result.height} · {result.frameCount} frames · {result.sampleFps} fps · {seedLabel(result.seed)}
              </span>
              <div class="video-lab-selection-actions">
                <button
                  class="text-button"
                  type="button"
                  onClick={
                    editSelection
                  }
                >
                  Change subject
                </button>
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
          <div class="video-lab-error">
            <div
              class="error-card"
              role="alert"
            >
              {message}
            </div>
            <Show
              when={
                selectedFile() !==
                undefined
              }
            >
              <button
                class="text-button"
                type="button"
                onClick={
                  editSelection
                }
              >
                Back to subject selection
              </button>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
};
