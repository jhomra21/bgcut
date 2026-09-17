export type ChevronSide = "left" | "right";

export const chevronOpacity = (side: ChevronSide, highlightedSide: ChevronSide | undefined): number => {
  return highlightedSide === undefined || side === highlightedSide ? 1 : 0.3;
};

export const chevronColor = (side: ChevronSide, highlightedSide: ChevronSide | undefined): string => {
  return highlightedSide === undefined || side === highlightedSide ? "#171717" : "#a3a39c";
};
