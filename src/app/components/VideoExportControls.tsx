import { Show } from "solid-js";
import type { VideoExportSettings } from "../../browser/video-export";

type ExportControlsProps = {
  readonly trimStart: () => number; readonly setTrimStart: (value: number) => void;
  readonly trimEnd: () => number; readonly setTrimEnd: (value: number) => void;
  readonly selectionDuration: () => number; readonly selectionTime: () => number;
  readonly resetSubjects: () => void; readonly scrubSelection: (value: number) => void;
  readonly exportFormat: () => "webm" | "mp4"; readonly setExportFormat: (value: "webm" | "mp4") => void;
  readonly background: () => "white" | "black"; readonly setBackground: (value: "white" | "black") => void;
  readonly exportQuality: () => "low" | "medium" | "high"; readonly setExportQuality: (value: "low" | "medium" | "high") => void;
  readonly exportSize: () => VideoExportSettings["size"]; readonly setExportSize: (value: VideoExportSettings["size"]) => void;
  readonly frameRate: () => NonNullable<VideoExportSettings["frameRate"]>; readonly setFrameRate: (value: NonNullable<VideoExportSettings["frameRate"]>) => void;
  readonly title: () => string; readonly setTitle: (value: string) => void;
};

export const VideoExportControls = (props: ExportControlsProps) => (
          <fieldset class="video-lab-export">
            <legend>Export</legend>
            <div class="video-lab-export-fields">
              <label>Start (seconds)
                <input type="number" min="0" max={props.selectionDuration()} step={1 / 60} value={props.trimStart()}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    props.setTrimStart(value);
                    props.resetSubjects();

                    if (Number.isFinite(value)) props.scrubSelection(value);
                  }} />
              </label>
              <label>End (seconds)
                <input type="number" min="0" max={props.selectionDuration()} step="0.1" value={props.trimEnd()}
                  onChange={(event) => {
                    props.setTrimEnd(event.currentTarget.valueAsNumber);
                    props.resetSubjects();

                    if (props.selectionTime() >= props.trimEnd()) props.scrubSelection(props.trimStart());
                  }} />
              </label>
              <label>Format
                <select value={props.exportFormat()} onChange={(event) => props.setExportFormat(event.currentTarget.value === "mp4" ? "mp4" : "webm")}>
                  <option value="webm">WebM · transparent (VP9)</option>
                  <option value="mp4">MP4 · solid background (H.264)</option>
                </select>
              </label>
              <Show when={props.exportFormat() === "mp4"}>
                <label>Background
                  <select value={props.background()} onChange={(event) => props.setBackground(event.currentTarget.value === "black" ? "black" : "white")}>
                    <option value="white">White</option><option value="black">Black</option>
                  </select>
                </label>
              </Show>
              <label>Quality
                <select value={props.exportQuality()} onChange={(event) => {
                  const value = event.currentTarget.value;

                  if (value === "low" || value === "medium" || value === "high") props.setExportQuality(value);
                }}>
                  <option value="low">Smaller file</option><option value="medium">Balanced</option><option value="high">Higher quality</option>
                </select>
              </label>
              <label>Size · longest edge
                <select value={String(props.exportSize())} onChange={(event) => {
                  const value = event.currentTarget.value;

                  if (value === "original") props.setExportSize("original");
                  else if (value === "720") props.setExportSize(720);
                  else if (value === "1280") props.setExportSize(1280);
                  else if (value === "1920") props.setExportSize(1920);
                }}>
                  <option value="720">720 px</option><option value="1280">1280 px</option>
                  <option value="1920">1920 px</option><option value="original">Original size</option>
                </select>
              </label>
              <label>Frame rate limit
                <select value={String(props.frameRate())} onChange={(event) => {
                  const value = event.currentTarget.value;

                  if (value === "source") props.setFrameRate("source");
                  else if (value === "6") props.setFrameRate(6);
                  else if (value === "24") props.setFrameRate(24);
                  else if (value === "30") props.setFrameRate(30);
                  else if (value === "60") props.setFrameRate(60);
                }}>
                  <option value="source">Source · up to 60 fps</option><option value="24">Up to 24 fps</option>
                  <option value="30">Up to 30 fps</option><option value="60">Up to 60 fps</option><option value="6">Up to 6 fps · fewer frames</option>
                </select>
              </label>
              <label>Title metadata (optional)
                <input type="text" maxlength="200" value={props.title()} onInput={(event) => props.setTitle(event.currentTarget.value)} />
              </label>
            </div>
            <p>Choose up to 15 seconds anywhere in the source. Export is silent and follows real source frames up to the selected rate; size never upscales. Original metadata is not copied. Only your optional title is written.</p>
          </fieldset>
);
