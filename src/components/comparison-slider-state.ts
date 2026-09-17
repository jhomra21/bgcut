export const chevronOpacity = (side: "left" | "right", position: number): number => {
  if (position === 50) {
    return 1;
  }

  const activeSide = position < 50 ? "left" : "right";

  return side === activeSide ? 1 : 0.3;
};
