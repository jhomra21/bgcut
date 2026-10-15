/** Select real presentation timestamps nearest the output cadence; never invent motion. */
export const selectVideoTimestamps = (
  source: readonly number[],
  start: number,
  end: number,
  maxFps: number,
): readonly number[] => {
  const candidates = [start, ...new Set(source.filter((time) => time > start && time < end))];
  candidates.sort((a, b) => a - b);
  const selected = [start];
  let cursor = 0;

  for (let index = 1; index < Math.ceil((end - start) * maxFps); index += 1) {
    const target = start + index / maxFps;

    while (cursor + 1 < candidates.length) {
      const current = candidates[cursor];
      const next = candidates[cursor + 1];

      if (current === undefined || next === undefined || Math.abs(next - target) > Math.abs(current - target)) break;

      cursor += 1;
    }

    const timestamp = candidates[cursor];

    if (timestamp !== undefined && timestamp !== selected.at(-1)) selected.push(timestamp);
  }

  return selected;
};
