export type VideoSegmentationCandidateId = "sam21-tiny" | "edgetam";

export type VideoModelGraphRole =
  | "vision-encoder"
  | "mask-decoder"
  | "memory-attention"
  | "memory-encoder";

export type VideoModelArtifact = {
  readonly role: VideoModelGraphRole | "constants";
  readonly filename: string;
  readonly url: string;
  readonly reportedSizeMb?: number;
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
};

export type VideoSegmentationMask = {
  readonly logits: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly iou?: number;
  readonly objectScore?: number;
};

export type VideoSegmentationAdapter = {
  readonly candidate: VideoSegmentationCandidate;
  seed(
    frame: VideoFrame,
    prompt: VideoSegmentationPrompt,
    frameIndex: number,
    totalFrames: number,
  ): Promise<VideoSegmentationMask>;
  track(
    frame: VideoFrame,
    frameIndex: number,
    totalFrames: number,
  ): Promise<VideoSegmentationMask>;
  rewind(): void;
  close(): Promise<void>;
};

export type VideoSegmentationAdapterFactory = (
  candidate: VideoSegmentationCandidate,
  onProgress?: (progress: number) => void,
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
    readonly trackedFps: number;
    readonly meanTemporalMaskIou: number | null;
  };
};
