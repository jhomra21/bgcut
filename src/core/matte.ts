export const logitToAlphaByte = (logit: number): number =>
  Math.round(255 / (1 + Math.exp(-logit)));
