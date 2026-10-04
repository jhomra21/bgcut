export {};

declare global {
  var __BGCUT_VIDEO_SEGMENTATION_BENCHMARK__:
    | {
        readonly candidates: typeof import("./candidates").VIDEO_SEGMENTATION_CANDIDATES;
        readonly createVideoSegmentationAdapter: typeof import("./adapter").createVideoSegmentationAdapter;
        readonly openMediaBunnyVideoSource: typeof import("./media-source").openMediaBunnyVideoSource;
        readonly reportedModelSizeMb: typeof import("./candidates").reportedModelSizeMb;
        readonly runVideoSegmentationBenchmark: typeof import("./runner").runVideoSegmentationBenchmark;
      }
    | undefined;
}
