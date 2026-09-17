export const chevronOpacity = (side: "left" | "right", position: number): number => {
  if (position === 50) {
    return 1;
  }

  const activeSide = position < 50 ? "left" : "right";

  return side === activeSide ? 1 : 0.3;
};

export const chevronColor = (side: "left" | "right", position: number): string => {
  if (position === 50) {
    return "#171717";
  }

  const activeSide = position < 50 ? "left" : "right";

  return side === activeSide ? "#171717" : "#a3a39c";
};
