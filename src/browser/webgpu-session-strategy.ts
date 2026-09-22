export type WebGpuSessionStrategy =
  | "capture-reuse"
  | "capture-recreate"
  | "no-capture-reuse";

const SAFARI_TOKEN = /Safari\//u;

const SAFARI_VERSION_TOKEN = /Version\//u;

const NON_SAFARI_WEBKIT_TOKEN =
  /(?:Chrome|Chromium|CriOS|Edg|OPR|FxiOS)\//u;

export const isSafariUserAgent = (
  userAgent: string,
): boolean =>
  SAFARI_TOKEN.test(userAgent) &&
  SAFARI_VERSION_TOKEN.test(userAgent) &&
  !NON_SAFARI_WEBKIT_TOKEN.test(userAgent);

export const resolveDefaultWebGpuSessionStrategy = (
  userAgent: string,
): WebGpuSessionStrategy =>
  isSafariUserAgent(userAgent)
    ? "no-capture-reuse"
    : "capture-reuse";
