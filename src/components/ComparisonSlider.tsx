import { createSignal } from "solid-js";

type ComparisonSliderProps = {
  readonly leftSrc: string;
  readonly rightSrc: string;
  readonly leftAlt: string;
  readonly rightAlt: string;
};

const ComparisonSlider = (props: ComparisonSliderProps) => {
  const [position, setPosition] = createSignal(50);

  const handleInput = (event: InputEvent) => {
    const input = event.currentTarget;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    setPosition(Number(input.value));
  };

  return (
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
        aria-label="Compare original image with background-removed result"
        onInput={handleInput}
      />
    </div>
  );
};

export default ComparisonSlider;
