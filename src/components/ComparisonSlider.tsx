import { createSignal } from "solid-js";
import { chevronColor, chevronHighlight, chevronOpacity, type ChevronSide } from "./comparison-slider-state";

export { chevronColor, chevronHighlight, chevronOpacity } from "./comparison-slider-state";

type ComparisonSliderProps = {
  readonly leftSrc: string;
  readonly rightSrc: string;
  readonly leftAlt: string;
  readonly rightAlt: string;
};

const ComparisonSlider = (props: ComparisonSliderProps) => {
  const [position, setPosition] = createSignal(50);
  const [hoverSide, setHoverSide] = createSignal<ChevronSide>();
  const [dragDirection, setDragDirection] = createSignal<ChevronSide>();
  const [isDragging, setIsDragging] = createSignal(false);

  const setPointerSide = (event: PointerEvent) => {
    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const bounds = input.getBoundingClientRect();
    const dividerX = bounds.left + (position() / 100) * bounds.width;
    const handleDeadZone = 24;

    if (Math.abs(event.clientX - dividerX) <= handleDeadZone) {
      setHoverSide(undefined);

      return;
    }

    setHoverSide(event.clientX < dividerX ? "left" : "right");
  };

  const handleInput = (event: InputEvent) => {
    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const nextPosition = Number(input.value);
    const previousPosition = position();

    if (nextPosition !== previousPosition) {
      setDragDirection(nextPosition < previousPosition ? "left" : "right");
    }

    setPosition(nextPosition);
  };

  const currentPosition = () => position();
  const highlightedSide = () => (isDragging() ? dragDirection() ?? hoverSide() : hoverSide());

  const comparisonStyle = () => {
    const current = currentPosition();
    const highlighted = highlightedSide();

    return `--comparison-position: ${current}%; --comparison-left-opacity: ${chevronOpacity("left", highlighted)}; --comparison-right-opacity: ${chevronOpacity("right", highlighted)}; --comparison-left-color: ${chevronColor("left", highlighted)}; --comparison-right-color: ${chevronColor("right", highlighted)}; --comparison-left-highlight: ${chevronHighlight("left", highlighted)}; --comparison-right-highlight: ${chevronHighlight("right", highlighted)};`;
  };

  return (
    <div
      class="comparison-slider checkerboard"
      style={comparisonStyle()}
    >
      <div class="comparison-layer">
        <img class="comparison-image" src={props.rightSrc} alt={props.rightAlt} />
      </div>

      <div class="comparison-layer comparison-reveal">
        <img class="comparison-image" src={props.leftSrc} alt={props.leftAlt} />
      </div>

      <div class="comparison-divider" aria-hidden="true">
        <span class="comparison-chevron comparison-chevron-left">‹</span>
        <span class="comparison-chevron comparison-chevron-right">›</span>
      </div>

      <input
        class="comparison-range"
        type="range"
        min="0"
        max="100"
        value={position()}
        aria-label="Compare original image with background-removed result"
        onInput={handleInput}
        onPointerDown={(event) => {
          setIsDragging(true);
          setDragDirection(undefined);
          setPointerSide(event);
        }}
        onPointerMove={setPointerSide}
        onPointerUp={(event) => {
          setPointerSide(event);
          setIsDragging(false);
          setDragDirection(undefined);
        }}
        onPointerCancel={() => {
          setIsDragging(false);
          setDragDirection(undefined);
        }}
        onPointerLeave={() => setHoverSide(undefined)}
      />
    </div>
  );
};

export default ComparisonSlider;
