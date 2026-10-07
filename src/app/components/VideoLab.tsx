import {
  For,
  Show,
  createSignal,
  createEffect,
  onSettled,
  onCleanup,
} from "solid-js";

import {
  isSafariUserAgent,
} from "../../browser/webgpu-session-strategy";
import {
  TRACKED_MASK_DECODER_PUBLIC_PATH,
  TRACKED_STEP_PUBLIC_PATH,
} from "../../shared/video-experimental-config";

import { VideoExportControls } from "./VideoExportControls";

import type { VideoExportSettings } from "../../browser/video-export";

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
  format: "webm" | "mp4",
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

  return `${base || "video"}-${format === "webm" ? "transparent" : "cutout"}.${format}`;
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

export const VideoLab = (props: { readonly file: File; readonly onChangeMedia: () => void }) => {
  const safari =
    typeof navigator !==
      "undefined" &&
    isSafariUserAgent(
      navigator.userAgent,
    );

  const [trimStart, setTrimStart] = createSignal(0);
  const [trimEnd, setTrimEnd] = createSignal(0);
  const [exportFormat, setExportFormat] = createSignal<"webm" | "mp4">(safari ? "mp4" : "webm");
  const [exportQuality, setExportQuality] = createSignal<"low" | "medium" | "high">("high");
  const [exportSize, setExportSize] = createSignal<VideoExportSettings["size"]>("original");
  const [frameRate, setFrameRate] = createSignal<NonNullable<VideoExportSettings["frameRate"]>>("source");
  const [frameStatus, setFrameStatus] = createSignal<"waiting" | "warming" | "ready" | "error">("waiting");
  const [frameError, setFrameError] = createSignal("");
  const [sourceAspect, setSourceAspect] = createSignal(16 / 9);
  const [frameRevision, setFrameRevision] = createSignal(0);
  const [background, setBackground] = createSignal<"white" | "black">("white");
  const [title, setTitle] = createSignal("");
  const [previewMessage, setPreviewMessage] = createSignal("");
  const [selectionStatus, setSelectionStatus] = createSignal<"idle" | "updating" | "ready" | "error">("idle");
  const previewReady = () => selectionStatus() === "ready";
  const [modelStatus, setModelStatus] = createSignal<"loading" | "ready" | "error">("loading");
  const [modelProgress, setModelProgress] = createSignal(0);
  const [modelError, setModelError] = createSignal("");
  const [previewRevision, setPreviewRevision] = createSignal(0);
  const [encodingStatus, setEncodingStatus] = createSignal<"checking" | "ready" | "error">("checking");
  const [encodingError, setEncodingError] = createSignal("");
  const [playbackError, setPlaybackError] = createSignal(false);
  let playback: HTMLVideoElement | undefined;
  let lastMaskIdentity = "";
  let alive = true;
  let maskPreview: HTMLCanvasElement | undefined;
  let editor: Promise<ReturnType<VideoModule["createVideoSelection"]>> | undefined;
  let runController: AbortController | undefined;
  let sourceFirstTimestamp = 0;

  const getEditor = () => {
    editor ??=
      loadVideoModule().then(
        (module) =>
          module.createVideoSelection(
            props.file,
            {
              trackedMaskDecoderUrl:
                TRACKED_MASK_DECODER_PUBLIC_PATH,
              trackedStepUrl:
                TRACKED_STEP_PUBLIC_PATH,
            },
          ),
      );

    return editor;
  };

  const prepareModel = () => {
    setModelStatus("loading");
    setModelProgress(0);
    setModelError("");
    void getEditor().then((session) => session.prepare((value) => {
      if (alive) setModelProgress(value);
    })).then(() => {
      if (alive) setModelStatus("ready");
    }).catch((error) => {
      if (!alive) return;

      setModelStatus("error");
      setModelError(error instanceof Error ? error.message : String(error));
    });
  };

  const validTrim = () => Number.isFinite(trimStart()) && Number.isFinite(trimEnd()) &&
    trimStart() >= 0 && trimEnd() > trimStart() && trimEnd() <= selectionDuration() && trimEnd() - trimStart() <= 15;


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

  const replacePoints = (
    nextPoints:
      readonly PromptPoint[],
  ) => {
    const id =
      activeSubjectId();

    setSubjects(
      (current) =>
        current.map(
          (subject) =>
            subject.id ===
            id
              ? {
                  ...subject,
                  points:
                    nextPoints,
                }
              : subject,
        ),
    );
  };

  const updatePoints = (
    update: (
      current:
        readonly PromptPoint[],
    ) =>
      readonly PromptPoint[],
  ) => {
    const id =
      activeSubjectId();

    setSubjects(
      (current) =>
        current.map(
          (subject) =>
            subject.id ===
            id
              ? {
                  ...subject,
                  points:
                    update(
                      subject.points,
                    ),
                }
              : subject,
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
        replacePoints(
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

    const selectionVersion = version;
    setState({ status: "selecting", fileName: file.name });
    setSelectionUrl(URL.createObjectURL(file));
    prepareModel();

    void loadVideoModule().then((module) => module.inspectVideo(file)).then((info) => {
      if (version !== selectionVersion) return;

      sourceFirstTimestamp = info.firstTimestamp;
      setSourceAspect(info.width / info.height);
      setSelectionDuration(info.duration);
      setTrimStart(0);
      setTrimEnd(Math.min(15, info.duration));

      if (selectionVideo !== undefined && sourceFirstTimestamp > 0) {
        selectionVideo.currentTime = sourceFirstTimestamp;
      }
    }).catch((error) => {
      if (version !== selectionVersion) return;

      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
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

    const settings: VideoExportSettings = {
      start: trimStart(), end: trimEnd(), format: exportFormat(),
      size: exportSize(), quality: exportQuality(), background: background(), title: title(), frameRate: frameRate(),
    };

    setPlaybackError(false);
    const controller = new AbortController();
    runController = controller;
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

    void getEditor()
      .then(
        (video) =>
          video.run(
            {
              subjects: selectedSubjects,
              export: settings,
              signal: controller.signal,
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
                settings.format ?? "webm",
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
      prepareModel();

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
      Math.min(duration, Math.max(0, value));

    setSelectionFrameReady(false);
    video.pause();
    video.currentTime = sourceFirstTimestamp + time;

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

      updatePoints(
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

  createEffect(
    () => ({ selecting: selecting(), model: modelStatus(), time: selectionTime(), duration: selectionDuration(), revision: frameRevision() }),
    (selection) => {
      const controller = new AbortController();
      setFrameStatus("waiting");

      if (!selection.selecting || selection.model !== "ready" || selection.duration <= 0) return;

      setFrameStatus("warming");
      setFrameError("");
      void getEditor().then((session) => session.prepareFrame(selection.time, controller.signal)).then(() => {
        if (!controller.signal.aborted) setFrameStatus("ready");
      }).catch((error) => {
        if (controller.signal.aborted) return;
        setFrameStatus("error");
        setFrameError(error instanceof Error ? error.message : String(error));
      });
      onCleanup(() => controller.abort());
    },
  );

  createEffect(
    () => ({ selecting: selecting(), ready: selectionFrameReady(), time: selectionTime(), subjects: readySubjects(), model: modelStatus(), frame: frameStatus(), revision: previewRevision() }),
    (selection) => {
      const controller = new AbortController();
      const canvas = maskPreview;
      const identity = `${selection.time}:${selection.subjects.map((subject) => subject.id).join(",")}`;

      if (!selection.selecting || !selection.ready || identity !== lastMaskIdentity) {
        canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        lastMaskIdentity = "";
      }

      setSelectionStatus("idle");

      if (!selection.selecting || !selection.ready || selection.subjects.length === 0) {
        setPreviewMessage("");

        return;
      }

      setSelectionStatus("updating");

      if (selection.model !== "ready" || selection.frame !== "ready") {
        setPreviewMessage(selection.model === "error" ? "Selection paused. Retry model loading below." : "Clicks saved; preparing selection…");

        return;
      }

      setPreviewMessage(lastMaskIdentity === identity ? "Updating selection…" : "Selecting subject locally…");

      const timer = setTimeout(() => {
        void getEditor().then((session) => session.preview(
          selection.time,
          selection.subjects.map((subject) => ({ id: subject.id, prompt: { points: subject.points } })),
          controller.signal,
        )).then((masks) => {
          if (controller.signal.aborted || canvas === undefined) return;
          const first = masks[0];

          if (first === undefined) return;
          canvas.width = first.width;
          canvas.height = first.height;
          const context = canvas.getContext("2d");

          if (context === null) return;
          const pixels = context.createImageData(canvas.width, canvas.height);
          const colors = [[42, 170, 110], [65, 130, 230], [220, 140, 40], [180, 90, 210]];

          for (let subjectIndex = 0; subjectIndex < masks.length; subjectIndex += 1) {
            const mask = masks[subjectIndex];
            const color = colors[subjectIndex];

            if (mask === undefined || color === undefined) continue;

            for (let index = 0; index < mask.alpha.length; index += 1) {
              if ((mask.alpha[index] ?? 0) === 0) continue;
              pixels.data[index * 4] = color[0] ?? 0;
              pixels.data[index * 4 + 1] = color[1] ?? 0;
              pixels.data[index * 4 + 2] = color[2] ?? 0;
              pixels.data[index * 4 + 3] = mask.alpha[index] ?? 0;
            }
          }

          context.putImageData(pixels, 0, 0);
          lastMaskIdentity = identity;
          setSelectionStatus("ready");
          setPreviewMessage("Highlighted selection ready.");
        }).catch((error) => {
          if (!controller.signal.aborted) {
            setSelectionStatus("error");
            setPreviewMessage(error instanceof Error ? error.message : String(error));
          }
        });
      }, 180);

      onCleanup(() => {
        clearTimeout(timer);
        controller.abort();
      });
    },
  );

  createEffect(
    () => ({ valid: validTrim(), format: exportFormat(), quality: exportQuality(), size: exportSize(), start: trimStart(), end: trimEnd(), frameRate: frameRate() }),
    (settings) => {
      let current = true;
      setEncodingStatus("checking");
      setEncodingError("");

      if (!settings.valid) return;

      void loadVideoModule().then((module) => module.checkVideoEncoding(props.file, settings)).then(() => {
        if (current) setEncodingStatus("ready");
      }).catch((error) => {
        if (!current) return;

        setEncodingStatus("error");
        setEncodingError(error instanceof Error ? error.message : String(error));
      });
      onCleanup(() => { current = false; });
    },
  );

  onSettled(() => chooseFile(props.file));

  onCleanup(
    () => {
      alive = false;
      version += 1;
      runController?.abort();
      void editor?.then((session) => session.close()).catch(() => undefined);
      clearResultUrl();
      clearSelectionUrl();
    },
  );

  return (
    <section
      class="video-lab"
      aria-label="Video editor"
    >
      <Show
        when={
          selecting()
        }
      >
        <div class="video-lab-selection">
          <div class="video-lab-selection-frame" style={{ "--video-aspect": sourceAspect(), "--video-viewport-width": `${sourceAspect() * 42}svh` }}>
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
              onError={() => setState({
                status: "error",
                message: "This browser could not open the video. Try an H.264 MP4 or choose another file.",
              })}
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

                const time = sourceFirstTimestamp + selectionTime();

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
                  selectionVideo !== undefined &&
                  Math.abs(selectionVideo.currentTime - sourceFirstTimestamp - selectionTime()) <= 0.04
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
                    video.currentTime - sourceFirstTimestamp -
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
            <canvas class="video-lab-mask-overlay" ref={(element) => { maskPreview = element; }} aria-hidden="true" />
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
                aria-label="Click inside the subject to select it"
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

          <div class="video-lab-selection-footer">
            <div class="video-lab-selection-actions">
              <button class="text-button" type="button" onClick={() => props.onChangeMedia()}>Change media</button>
              <button
                class="download-button"
                type="button"
                disabled={
                  !previewReady() || !validTrim() || encodingStatus() !== "ready"
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
          <div class="video-lab-model-status" hidden={modelStatus() === "ready"} role="status" data-state={modelStatus()}>
            <Show when={modelStatus() === "loading"}>
              <span>Preparing selection · {Math.round(Math.min(1, modelProgress() / 0.4) * 2)}/2 sessions. Click while loading.</span>
              <progress max="1" value={modelProgress()} aria-label="Selection model loading" />
            </Show>

            <Show when={modelStatus() === "error"}>
              <span>{modelError()}</span>
              <button class="text-button" type="button" onClick={prepareModel}>Retry model loading</button>
            </Show>
          </div>

          <div class="video-lab-frame-status" role="status" data-state={frameStatus()}>
            <Show when={modelStatus() === "ready" && frameStatus() !== "error"}>
              <span>{frameStatus() === "ready" ? "Click inside a subject. No outlining needed." : "Warming this frame… Your clicks are saved."}</span>
            </Show>
            <Show when={frameStatus() === "error"}>
              <span>{frameError()}</span>
              <button class="text-button" type="button" onClick={() => setFrameRevision((value) => value + 1)}>Retry frame</button>
            </Show>
          </div>
          <div class="video-lab-export-notices">
            <Show when={!validTrim()}><p role="alert">Choose a valid range of up to 15 seconds within this video.</p></Show>
            <Show when={exportFormat() === "mp4"}><p>MP4 · {background()} background, no transparency.</p></Show>
            <Show when={safari && exportFormat() === "webm"}><p>Transparent WebM: download for an alpha-capable editor; Safari playback is not supported.</p></Show>
            <Show when={encodingStatus() === "checking" && validTrim()}><p role="status">Checking browser encoding support…</p></Show>
            <Show when={encodingStatus() === "error"}><p role="alert">{encodingError()}</p></Show>
          </div>

          <div class="video-lab-scrubber">
            <input
              type="range"
              min={trimStart()}
              max={Math.max(trimStart(), trimEnd() - 1 / 60)}
              step={1 / 60}
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

          <Show when={subjects().some((subject) => subject.points.length > 0)}>
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

          </div>

          <details class="video-lab-refine"><summary>Refine selection</summary>
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
                  updatePoints(
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
                  replacePoints(
                    [],
                  )
                }
              >
                Clear
              </button>
            </div>
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
          </details>
          </Show>
          <p class="video-lab-preview-status" role="status" data-state={selectionStatus()}>{previewMessage()}</p>
          <Show when={selectionStatus() === "error"}>
            <button class="text-button" type="button" onClick={() => setPreviewRevision((value) => value + 1)}>Retry selection</button>
          </Show>

          <details class="video-lab-export-details">
            <summary>Export settings &amp; trim · {exportFormat().toUpperCase()} · {exportSize() === "original" ? "Original size" : `${exportSize()} px`} · {frameRate() === "source" ? "Source ≤60 fps" : `≤${frameRate()} fps`}</summary>
            <button class="text-button" type="button" disabled={!validTrim() || encodingStatus() !== "ready"} onClick={() => run()}>Auto select instead</button>
            <VideoExportControls trimStart={trimStart} setTrimStart={setTrimStart} trimEnd={trimEnd} setTrimEnd={setTrimEnd} selectionDuration={selectionDuration} resetSubjects={resetSubjects} scrubSelection={scrubSelection} selectionTime={selectionTime} exportFormat={exportFormat} setExportFormat={setExportFormat} background={background} setBackground={setBackground} exportQuality={exportQuality} setExportQuality={setExportQuality} exportSize={exportSize} setExportSize={setExportSize} frameRate={frameRate} setFrameRate={setFrameRate} title={title} setTitle={setTitle} />
          </details>


        </div>
      </Show>

      <Show
        when={
          processing()
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

      <Show when={processing()}>
        <button class="text-button" type="button" onClick={() => {
          runController?.abort();
          editSelection();
        }}>Cancel processing</button>
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
        keyed
        when={ready()}
      >
        {(result) => (
          <div class="video-lab-result">
            <Show when={!safari || result.downloadName.endsWith(".mp4")} fallback={
              <p class="video-lab-preview-status">Transparent WebM is ready to download. Safari cannot reliably play its alpha; choose MP4 for playback here.</p>
            }>
              <video
                ref={(element) => { playback = element; }}
                class="video-lab-video checkerboard"
                src={result.url}
                controls
                loop
                playsinline
                preload="auto"
                onError={() => setPlaybackError(true)}
                onCanPlay={() => setPlaybackError(false)}
              />
              <Show when={playbackError()}>
                <div class="video-lab-error" role="alert">
                  <span>The preview could not play. Your download is still available.</span>
                  <button class="text-button" type="button" onClick={() => {
                    setPlaybackError(false);
                    playback?.load();
                  }}>Retry playback</button>
                </div>
              </Show>
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
                  Download video
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
            <button class="text-button" type="button" onClick={() => props.onChangeMedia()}>
              Choose another file
            </button>
          </div>
        )}
      </Show>
    </section>
  );
};
