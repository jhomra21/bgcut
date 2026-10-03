import { createVideoSegmentationAdapter } from "./adapter";
import {
  VIDEO_SEGMENTATION_CANDIDATES,
  reportedModelSizeMb,
} from "./candidates";
import { openMediaBunnyVideoSource } from "./media-source";
import { runVideoSegmentationBenchmark } from "./runner";

globalThis.__BGCUT_VIDEO_SEGMENTATION_BENCHMARK__ = {
  candidates: VIDEO_SEGMENTATION_CANDIDATES,
  createVideoSegmentationAdapter,
  openMediaBunnyVideoSource,
  reportedModelSizeMb,
  runVideoSegmentationBenchmark,
};
