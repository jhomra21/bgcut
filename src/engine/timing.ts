export type RemovalStageTimings = {
  readonly decodeMs: number;
  readonly runtimeMs: number;
  readonly modelDownloadMs: number;
  readonly sessionInitMs: number;
  readonly preprocessMs: number;
  readonly inferenceMs: number;
  readonly outputReadbackMs: number;
  readonly matteMs: number;
  readonly compositeMs: number;
  readonly exportMs: number;
};

export type RemovalTimings = RemovalStageTimings & {
  readonly totalMs: number;
  readonly sessionReused: boolean;
};

type MutableStageTimings = {
  decodeMs: number;
  runtimeMs: number;
  modelDownloadMs: number;
  sessionInitMs: number;
  preprocessMs: number;
  inferenceMs: number;
  outputReadbackMs: number;
  matteMs: number;
  compositeMs: number;
  exportMs: number;
};

type RemovalTimingStage = keyof MutableStageTimings;
type Now = () => number;

export type RemovalTimingRecorder = {
  readonly begin: (stage: RemovalTimingStage) => () => void;
  readonly markSessionReused: () => void;
  readonly finish: () => RemovalTimings;
};

const createEmptyStageTimings = (): MutableStageTimings => ({
  decodeMs: 0,
  runtimeMs: 0,
  modelDownloadMs: 0,
  sessionInitMs: 0,
  preprocessMs: 0,
  inferenceMs: 0,
  outputReadbackMs: 0,
  matteMs: 0,
  compositeMs: 0,
  exportMs: 0,
});

const roundMilliseconds = (value: number): number => Math.round(value * 1000) / 1000;

export const createRemovalTimingRecorder = (
  now: Now = () => performance.now(),
): RemovalTimingRecorder => {
  const totalStartedAt = now();
  const durations = createEmptyStageTimings();
  let sessionReused = false;

  return {
    begin: (stage) => {
      const startedAt = now();
      let stopped = false;

      return () => {
        if (stopped) {
          return;
        }

        stopped = true;
        durations[stage] += Math.max(0, now() - startedAt);
      };
    },
    markSessionReused: () => {
      sessionReused = true;
    },
    finish: () => ({
      decodeMs: roundMilliseconds(durations.decodeMs),
      runtimeMs: roundMilliseconds(durations.runtimeMs),
      modelDownloadMs: roundMilliseconds(durations.modelDownloadMs),
      sessionInitMs: roundMilliseconds(durations.sessionInitMs),
      preprocessMs: roundMilliseconds(durations.preprocessMs),
      inferenceMs: roundMilliseconds(durations.inferenceMs),
      outputReadbackMs: roundMilliseconds(durations.outputReadbackMs),
      matteMs: roundMilliseconds(durations.matteMs),
      compositeMs: roundMilliseconds(durations.compositeMs),
      exportMs: roundMilliseconds(durations.exportMs),
      totalMs: roundMilliseconds(Math.max(0, now() - totalStartedAt)),
      sessionReused,
    }),
  };
};
