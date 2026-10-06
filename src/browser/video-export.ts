import { Data } from "effect";

export class VideoExportError extends Data.TaggedError("VideoExportError")<{
  readonly message: string;
}> {}

export type VideoExportSettings = {
  readonly start: number;
  readonly end: number;
  readonly size?: "original" | 720 | 1280 | 1920;
  readonly quality?: "low" | "medium" | "high";
  readonly format?: "webm" | "mp4";
  readonly background?: "white" | "black";
  readonly title?: string;
  readonly frameRate?: "source" | 6 | 24 | 30 | 60;
};

type VideoSourceGeometry = {
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly firstTimestamp: number;
};

export const VIDEO_MAX_SECONDS = 15;

export const planVideoExport = (
  source: VideoSourceGeometry,
  settings: VideoExportSettings,
) => {
  const { start, end } = settings;

  if (
    !Number.isFinite(start) || !Number.isFinite(end) ||
    start < 0 || end <= start || end > source.duration ||
    end - start > VIDEO_MAX_SECONDS
  ) {
    throw new VideoExportError({
      message: "Choose a range within the video, longer than zero and no more than 15 seconds.",
    });
  }

  const format = settings.format ?? "webm";
  const size = settings.size ?? "original";
  const scale = size === "original" ? 1 : Math.min(1, size / Math.max(source.width, source.height));
  const duration = end - start;

  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
    duration,
    start,
    end,
    format,
    codec: format === "mp4" ? "avc" as const : "vp9" as const,
    alpha: format === "mp4" ? "discard" as const : "keep" as const,
    mime: format === "mp4" ? "video/mp4" : "video/webm",
    background: settings.background ?? "white",
    quality: settings.quality ?? "high",
    title: settings.title?.trim(),
    maxFps: settings.frameRate === undefined || settings.frameRate === "source" ? 60 : settings.frameRate,
  };
};
