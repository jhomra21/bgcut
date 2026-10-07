export type VideoSegmentationCandidateId = "sam21-tiny" | "edgetam";

export type VideoModelGraphRole =
  | "vision-encoder"
  | "mask-decoder"
  | "tracked-mask-decoder"
  | "tracked-memory-encoder"
  | "memory-attention"
  | "memory-encoder"
  | "pointer-tpos";

export type VideoModelAuxiliaryRole =
  | "constants"
  | "parameters";

export type VideoModelExternalData = {
  readonly filename: string;
  readonly url: string;
  readonly reportedSizeMb?: number;
};

export type VideoModelArtifact = {
  readonly role:
    | VideoModelGraphRole
    | VideoModelAuxiliaryRole;
  readonly filename: string;
  readonly url: string;
  readonly reportedSizeMb?: number;
  readonly externalData?:
    readonly VideoModelExternalData[];
};

export type VideoSegmentationCandidate = {
  readonly id: VideoSegmentationCandidateId;
  readonly label: string;
  readonly family: string;
  readonly inputSize: number;
  readonly license: "Apache-2.0";
  readonly repository: string;
  readonly baseModel: string;
  readonly artifacts: readonly VideoModelArtifact[];
};

export type VideoPointPrompt = {
  readonly x: number;
  readonly y: number;
  readonly label: 0 | 1;
};

export type VideoSegmentationPrompt = {
  readonly points: readonly VideoPointPrompt[];
  /**
   * Optional multimask proposal to commit as the temporal seed.
   *
   * Omit it to use the model's recommended proposal. A UI can surface
   * alternatives from the first seed result and rerun the seed with the
   * proposal the user chose.
   */
  readonly proposalIndex?: number;
};

export type VideoSegmentationSubjectPrompt = {
  readonly id: string;
  readonly prompt:
    VideoSegmentationPrompt;
};

export type VideoSegmentationMaskAlternative = {
  readonly logits: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly iou?: number;
  readonly objectScore?: number;
};

export type VideoSegmentationMask =
  VideoSegmentationMaskAlternative & {
    readonly alternatives?:
      readonly VideoSegmentationMaskAlternative[];
  };

export type VideoSegmentationDiscovery = {
  readonly point:
    VideoPointPrompt;
  readonly proposalIndex:
    number;
  readonly mask:
    VideoSegmentationMaskAlternative;
};

export type VideoFramePreparation = {
  readonly encodeMs: number;
  readonly promptWarmMs: number;
};

export type VideoSegmentationTimingSummary =
  Readonly<
    Record<
      string,
      {
        readonly calls:
          number;
        readonly totalMs:
          number;
      }
    >
  >;

export type VideoSegmentationAdapter = {
  readonly candidate: VideoSegmentationCandidate;
  timingSnapshot?():
    VideoSegmentationTimingSummary;
  prepareFrame?(
    frame: VideoFrame,
  ): Promise<
    VideoFramePreparation |
    void
  >;
  prepareTracking?(): Promise<void>;
  seed(
    frame: VideoFrame,
    prompt: VideoSegmentationPrompt,
    frameIndex: number,
    totalFrames: number,
  ): Promise<VideoSegmentationMask>;
  seedMask?(
    frame: VideoFrame,
    mask: VideoSegmentationMaskAlternative,
    frameIndex: number,
    totalFrames: number,
  ): Promise<VideoSegmentationMask>;
  track(
    frame: VideoFrame,
    frameIndex: number,
    totalFrames: number,
  ): Promise<VideoSegmentationMask>;
  previewSubjects?(
    frame: VideoFrame,
    subjects:
      readonly VideoSegmentationSubjectPrompt[],
  ): Promise<
    readonly VideoSegmentationMask[]
  >;
  seedSubjects?(
    frame: VideoFrame,
    subjects:
      readonly VideoSegmentationSubjectPrompt[],
    frameIndex: number,
    totalFrames: number,
  ): Promise<
    readonly VideoSegmentationMask[]
  >;
  trackSubjects?(
    frame: VideoFrame,
    frameIndex: number,
    totalFrames: number,
  ): Promise<
    readonly VideoSegmentationMask[]
  >;
  discover?(
    frame: VideoFrame,
    points:
      readonly VideoPointPrompt[],
  ): Promise<
    readonly VideoSegmentationDiscovery[]
  >;
  rewind(): void;
  rewindSubjects?(): void;
  close(): Promise<void>;
};

export type VideoSegmentationAdapterOptions = {
  readonly trackedMaskDecoderUrl?:
    string;
  readonly trackedMemoryEncoderUrl?:
    string;
};

export type VideoSegmentationAdapterFactory = (
  candidate: VideoSegmentationCandidate,
  onProgress?: (progress: number) => void,
  options?:
    VideoSegmentationAdapterOptions,
) => Promise<VideoSegmentationAdapter>;

export type DecodedVideoFrame = {
  readonly frame: VideoFrame;
  readonly timestamp: number;
  readonly decodeMs: number;
  close(): void;
};

export type VideoSourceInfo = {
  readonly width: number;
  readonly height: number;
  readonly firstTimestamp: number;
  readonly duration: number;
};

export type VideoFrameSource = {
  readonly info: VideoSourceInfo;
  frameTimes(start: number, end: number, maxFps: number, signal?: AbortSignal): Promise<readonly number[]>;
  frameAt(timestamp: number): Promise<DecodedVideoFrame | null>;
  framesAt(
    timestamps: readonly number[],
  ): AsyncIterable<DecodedVideoFrame | null>;
  close(): void;
};

export type VideoSegmentationBenchmarkSpec = {
  readonly sampleFps: number;
  readonly maxFrames: number;
  readonly seedIndex: number;
  readonly prompt: VideoSegmentationPrompt;
};

export type VideoSegmentationFrameReport = {
  readonly frameIndex: number;
  readonly timestamp: number;
  readonly decodeMs: number;
  readonly inferenceMs: number;
  readonly maskAreaFraction: number;
  readonly temporalMaskIou: number | null;
  readonly modelIou: number | null;
  readonly objectScore: number | null;
};

export type VideoSegmentationBenchmarkReport = {
  readonly schemaVersion: 1;
  readonly candidate: VideoSegmentationCandidateId;
  readonly modelReportedSizeMb: number;
  readonly loadMs: number;
  readonly width: number;
  readonly height: number;
  readonly requestedFrames: number;
  readonly decodedFrames: number;
  readonly seedFrame: number;
  readonly frames: readonly VideoSegmentationFrameReport[];
  readonly summary: {
    readonly meanDecodeMs: number;
    readonly meanInferenceMs: number;
    readonly p50InferenceMs: number;
    readonly p95InferenceMs: number;
    readonly meanTrackedInferenceMs: number;
    readonly p50TrackedInferenceMs: number;
    readonly p95TrackedInferenceMs: number;
    readonly trackedFps: number;
    readonly meanTemporalMaskIou: number | null;
  };
};
