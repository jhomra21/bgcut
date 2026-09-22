export type WebGpuCompositeMode = "gpu" | "cpu";

export const resolveWebGpuCompositeMode = (
  search: string,
): WebGpuCompositeMode =>
  new URLSearchParams(search).get("composite") === "cpu"
    ? "cpu"
    : "gpu";
