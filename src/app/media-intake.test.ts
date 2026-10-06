import { expect, test } from "bun:test";

import { isVideoFile } from "./media-intake";

test("routes videos including empty-MIME camera files without stealing image inputs", () => {
  for (const name of ["bear.MP4", "clip.mov", "clip.webm", "clip.m4v"]) {
    expect(isVideoFile(new File([], name))).toBe(true);
  }

  expect(isVideoFile(new File([], "recording", { type: "video/mp4" }))).toBe(true);
  expect(isVideoFile(new File([], "photo.png", { type: "image/png" }))).toBe(false);
  expect(isVideoFile(new File([], "photo.avif"))).toBe(false);
  expect(isVideoFile(new File([], "not-video.mp4", { type: "image/png" }))).toBe(false);
});
