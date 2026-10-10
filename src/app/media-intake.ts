export const isVideoFile = (file: File): boolean =>
  file.type.startsWith("video/") ||
  (file.type === "" && /\.(mp4|m4v|mov|webm|mkv|avi)$/iu.test(file.name));
