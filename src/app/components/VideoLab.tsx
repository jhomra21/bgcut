import {
  For,
  Show,
  createSignal,
  onCleanup,
} from "solid-js";

import {
  isSafariUserAgent,
} from "../../browser/webgpu-session-strategy";

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

type SubjectSelection = {
  readonly id: string;
  readonly points:
    readonly PromptPoint[];
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
        | "sam21-subjects"
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
    | "sam21-subjects"
    | "birefnet-direct"
    | "edgetam-grid",
): string => {
  switch (
    seed
  ) {
    case "sam21-prompt":
      return "selected subject";

    case "sam21-subjects":
      return "selected subjects";

    case "birefnet-direct":
      return "automatic subject";

    case "edgetam-grid":
      return "automatic fallback";
  }
};

const MAX_SELECTION_SECONDS =
  15;

const MAX_SUBJECTS =
  4;

const formatVideoTime = (
  seconds: number,
): string => {
  const safe =
    Number.isFinite(
      seconds,
    )
      ? Math.max(
          0,
          seconds,
        )
      : 0;

  const minutes =
    Math.floor(
      safe /
      60,
    );

  const remainder =
    Math.floor(
      safe %
      60,
    );

  return `${minutes}:${remainder
    .toString()
    .padStart(
      2,
      "0",
    )}`;
};

export const VideoLab = () => {
  const safari =
    typeof navigator !==
      "undefined" &&
    isSafariUserAgent(
      navigator.userAgent,
    );

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
    selectionTime,
    setSelectionTime,
  ] =
    createSignal(
      0,
    );

  const [
    selectionDuration,
    setSelectionDuration,
  ] =
    createSignal(
      0,
    );

  const [
    selectionFrameReady,
    setSelectionFrameReady,
  ] =
    createSignal(
      false,
    );

  const [
    promptMode,
    setPromptMode,
  ] =
    createSignal<PromptMode>(
      "keep",
    );

  const [
    subjects,
    setSubjects,
  ] =
    createSignal<
      readonly SubjectSelection[]
    >([
      {
        id:
          "subject-1",
        points: [],
      },
    ]);

  const [
    activeSubjectId,
    setActiveSubjectId,
  ] =
    createSignal(
      "subject-1",
    );

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

  let subjectSequence = 1;

  const resetSubjects =
    () => {
      subjectSequence = 1;

      setSubjects([
        {
          id:
            "subject-1",
          points: [],
        },
      ]);

      setActiveSubjectId(
        "subject-1",
      );
    };

  const activeSubject =
    () =>
      subjects().find(
        (subject) =>
          subject.id ===
          activeSubjectId(),
      );

  const points =
    () =>
      activeSubject()
        ?.points ??
      [];

  const setPoints = (
    update:
      | readonly PromptPoint[]
      | ((
          current:
            readonly PromptPoint[],
        ) =>
          readonly PromptPoint[]),
  ) => {
    const id =
      activeSubjectId();

    setSubjects(
      (current) =>
        current.map(
          (subject) => {
            if (
              subject.id !==
              id
            ) {
              return subject;
            }

            return {
              ...subject,
              points:
                typeof update ===
                "function"
                  ? update(
                      subject.points,
                    )
                  : update,
            };
          },
        ),
    );
  };

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

  const activeSubjectNumber =
    () =>
      Math.max(
        1,
        subjects().findIndex(
          (subject) =>
            subject.id ===
            activeSubjectId(),
        ) +
          1,
      );

  const readySubjects =
    () =>
      subjects().filter(
        (subject) =>
          subject.points.some(
            (point) =>
              point.label ===
              1,
          ),
      );

  const addSubject =
    () => {
      if (
        positivePoints() ===
          0 ||
        subjects().length >=
          MAX_SUBJECTS
      ) {
        return;
      }

      subjectSequence +=
        1;

      const id =
        `subject-${subjectSequence}`;

      setSubjects(
        (current) => [
          ...current,
          {
            id,
            points: [],
          },
        ],
      );

      setActiveSubjectId(
        id,
      );

      setPromptMode(
        "keep",
      );
    };

  const removeSubject =
    () => {
      const current =
        subjects();

      if (
        current.length <=
        1
      ) {
        setPoints(
          [],
        );

        return;
      }

      const index =
        current.findIndex(
          (subject) =>
            subject.id ===
            activeSubjectId(),
        );

      const next =
        current.filter(
          (subject) =>
            subject.id !==
            activeSubjectId(),
        );

      const replacement =
        next[
          Math.min(
            Math.max(
              0,
              index,
            ),
            next.length - 1,
          )
        ];

      setSubjects(
        next,
      );

      if (
        replacement !==
        undefined
      ) {
        setActiveSubjectId(
          replacement.id,
        );
      }
    };

  const chooseFile = (
    file: File,
  ) => {
    version += 1;
    clearResultUrl();
    clearSelectionUrl();

    setSelectedFile(
      file,
    );

    resetSubjects();

    setSelectionTime(
      0,
    );

    setSelectionDuration(
      0,
    );

    setSelectionFrameReady(
      false,
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
    selectedSubjects?:
      readonly {
        readonly id: string;
        readonly prompt: {
          readonly points:
            readonly PromptPoint[];
        };
      }[],
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
      selectedSubjects !==
        undefined &&
      selectedSubjects.length ===
        0
    ) {
      setState({
        status:
          "error",
        message:
          "Select at least one subject before removing the background.",
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
        selectedSubjects ===
        undefined
          ? "Finding a subject automatically…"
          : selectedSubjects.length >
              1
            ? `Loading SAM 2.1 for ${selectedSubjects.length} selected subjects…`
            : "Loading SAM 2.1 for your selected subject…",
      progress: 0,
    });

    void loadVideoModule()
      .then(
        (video) =>
          video.removeVideoBackgroundExperimental(
            file,
            {
              subjects:
                selectedSubjects,
              seedTimeSeconds:
                selectionTime(),
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

      setSelectionFrameReady(
        false,
      );

      setState({
        status:
          "selecting",
        fileName:
          file.name,
      });
    };

  const scrubSelection = (
    value: number,
  ) => {
    const video =
      selectionVideo;

    if (
      video ===
      undefined
    ) {
      return;
    }

    const duration =
      selectionDuration();

    const time =
      Math.min(
        duration,
        Math.max(
          0,
          value,
        ),
      );

    video.pause();
    video.currentTime =
      time;

    setSelectionTime(
      time,
    );

    resetSubjects();
  };

  const handleSelectionPointer =
    (
      event:
        PointerEvent,
    ) => {
      if (
        !event.isPrimary ||
        (
          event.pointerType ===
            "mouse" &&
          event.button !==
            0
        )
      ) {
        return;
      }

      event.preventDefault();

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
        Choose one or more subjects to keep, then SAM 2.1 tracks them through the video. You can still try automatic selection when a quick result matters more than precise control.
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
                Scrub to a useful frame, select each subject you want to keep, and add exclude points when nearby objects or background get included.
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
              class={
                selectionFrameReady()
                  ? "is-ready"
                  : ""
              }
              onLoadedMetadata={() => {
                const video =
                  selectionVideo;

                if (
                  video ===
                  undefined
                ) {
                  return;
                }

                video.pause();

                const duration =
                  Number.isFinite(
                    video.duration,
                  )
                    ? Math.min(
                        video.duration,
                        MAX_SELECTION_SECONDS,
                      )
                    : MAX_SELECTION_SECONDS;

                setSelectionDuration(
                  duration,
                );

                const time =
                  Math.min(
                    duration,
                    selectionTime(),
                  );

                setSelectionTime(
                  time,
                );

                if (
                  Math.abs(
                    video.currentTime -
                    time,
                  ) >
                  0.001
                ) {
                  video.currentTime =
                    time;
                }
              }}
              onLoadedData={() => {
                if (
                  selectionTime() <=
                  0.001
                ) {
                  setSelectionFrameReady(
                    true,
                  );
                }
              }}
              onSeeked={() => {
                const video =
                  selectionVideo;

                if (
                  video ===
                  undefined
                ) {
                  return;
                }

                if (
                  Math.abs(
                    video.currentTime -
                    selectionTime(),
                  ) <=
                  0.04
                ) {
                  setSelectionFrameReady(
                    true,
                  );
                }
              }}
            />
            <Show
              when={
                selectionFrameReady()
              }
              fallback={
                <div class="video-lab-selection-loading">
                  Restoring selected frame…
                </div>
              }
            >
              <div
                class="video-lab-selection-surface"
                aria-label="Add a selection point"
                onPointerDown={
                  handleSelectionPointer
                }
              />
              <For each={subjects()}>
                {(
                  subject,
                  subjectIndex,
                ) => (
                  <For each={subject.points}>
                    {(point) => (
                      <span
                        class={
                          [
                            "video-lab-point",
                            point.label ===
                            1
                              ? "is-keep"
                              : "is-exclude",
                            subject.id ===
                            activeSubjectId()
                              ? "is-active-subject"
                              : "is-other-subject",
                          ].join(
                            " ",
                          )
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
                          ? subjectIndex() +
                            1
                          : "−"}
                      </span>
                    )}
                  </For>
                )}
              </For>
            </Show>
          </div>

          <div class="video-lab-scrubber">
            <input
              type="range"
              min="0"
              max={
                selectionDuration()
              }
              step="0.01"
              value={
                selectionTime()
              }
              aria-label="Choose subject frame"
              onInput={(
                event,
              ) =>
                scrubSelection(
                  event.currentTarget
                    .valueAsNumber,
                )
              }
            />
            <div class="video-lab-scrubber-meta">
              <span>
                {formatVideoTime(
                  selectionTime(),
                )} / {formatVideoTime(
                  selectionDuration(),
                )}
              </span>
              <span>
                Pick the frame where your subject is easiest to identify.
              </span>
            </div>
          </div>

          <div class="video-lab-subjects">
            <div
              class="video-lab-subject-tabs"
              role="group"
              aria-label="Tracked subjects"
            >
              <For each={subjects()}>
                {(
                  subject,
                  index,
                ) => (
                  <button
                    class={
                      subject.id ===
                      activeSubjectId()
                        ? "text-button is-active"
                        : "text-button"
                    }
                    type="button"
                    aria-pressed={
                      subject.id ===
                      activeSubjectId()
                        ? "true"
                        : "false"
                    }
                    onClick={() => {
                      setActiveSubjectId(
                        subject.id,
                      );

                      setPromptMode(
                        "keep",
                      );
                    }}
                  >
                    Subject {index() + 1}
                  </button>
                )}
              </For>
              <button
                class="text-button"
                type="button"
                disabled={
                  positivePoints() ===
                    0 ||
                  subjects().length >=
                    MAX_SUBJECTS
                }
                onClick={
                  addSubject
                }
              >
                Add subject
              </button>
            </div>

            <button
              class="text-button"
              type="button"
              onClick={
                removeSubject
              }
            >
              {subjects().length >
              1
                ? "Remove subject"
                : "Clear subject"}
            </button>
          </div>

          <div class="video-lab-selection-toolbar">
            <div
              class="video-lab-prompt-modes"
              role="group"
              aria-label="Selection point type"
            >
              <button
                class={
                  promptMode() ===
                  "keep"
                    ? "text-button is-active"
                    : "text-button"
                }
                type="button"
                aria-pressed={
                  promptMode() ===
                  "keep"
                    ? "true"
                    : "false"
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
                class={
                  promptMode() ===
                  "exclude"
                    ? "text-button is-active"
                    : "text-button"
                }
                type="button"
                aria-pressed={
                  promptMode() ===
                  "exclude"
                    ? "true"
                    : "false"
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
                ? `Subject ${activeSubjectNumber()}: add at least one Keep point.`
                : `Subject ${activeSubjectNumber()}: ${positivePoints()} keep point${positivePoints() === 1 ? "" : "s"} · ${points().length - positivePoints()} exclude · ${readySubjects().length} subject${readySubjects().length === 1 ? "" : "s"} ready`}
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
                  readySubjects().length ===
                  0
                }
                onClick={() =>
                  run(
                    readySubjects().map(
                      (subject) => ({
                        id:
                          subject.id,
                        prompt: {
                          points:
                            subject.points,
                        },
                      }),
                    ),
                  )
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
            <Show
              when={
                !safari
              }
              fallback={
                <div class="video-lab-safari-preview-note checkerboard">
                  <span>
                    Safari does not preview transparent WebM correctly. The checkerboard frame above shows the transparency result; the downloaded WebM keeps its alpha.
                  </span>
                </div>
              }
            >
              <video
                class="video-lab-video checkerboard"
                src={result.url}
                controls
                loop
                playsinline
              />
            </Show>
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
