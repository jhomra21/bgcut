import { createSignal } from "solid-js";

type ComparisonSliderProps = {
  readonly leftSrc: string;
  readonly rightSrc: string;
  readonly leftAlt: string;
  readonly rightAlt: string;
  readonly leftLabel: string;
  readonly rightLabel: string;
};

const ComparisonSlider = (props: ComparisonSliderProps) => {
  const [position, setPosition] = createSignal(50);

  const visibleRightLabel = (): string =>
    props.leftLabel === "Original" ? "Background removed" : props.rightLabel;

  const handleInput = (event: InputEvent) => {
    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    setPosition(Number(input.value));
  };

  return (
    <figure class="comparison-card">
      <div
        class="comparison-slider checkerboard"
        style={`--comparison-position: ${position()}%;`}
      >
        <div class="comparison-layer">
          <img class="comparison-image" src={props.rightSrc} alt={props.rightAlt} />
        </div>

        <div class="comparison-layer comparison-reveal">
          <img class="comparison-image" src={props.leftSrc} alt={props.leftAlt} />
        </div>

        <div class="comparison-divider" aria-hidden="true">
          <span>↔</span>
        </div>

        <input
          class="comparison-range"
          type="range"
          min="0"
          max="100"
          value={position()}
          aria-label={`Compare ${props.leftLabel} with ${visibleRightLabel()}`}
          onInput={handleInput}
        />
      </div>

      <figcaption class="comparison-labels">
        <span>{props.leftLabel}</span>
        <span>{visibleRightLabel()}</span>
      </figcaption>
    </figure>
  );
};

export default ComparisonSlider;
