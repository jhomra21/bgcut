import {
  describe,
  expect,
  test,
} from "bun:test";

import {
  binaryMaskIou,
  davisBoundaryF,
} from "./quality-metrics";

const square = (
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array => {
  const mask =
    new Uint8Array(
      width *
        height,
    );

  for (
    let y = y0;
    y < y1;
    y += 1
  ) {
    for (
      let x = x0;
      x < x1;
      x += 1
    ) {
      mask[
        y *
          width +
          x
      ] = 1;
    }
  }

  return mask;
};

describe(
  "DAVIS quality metrics",
  () => {
    test(
      "returns perfect overlap and boundary scores for identical masks",
      () => {
        const mask =
          square(
            16,
            16,
            4,
            4,
            12,
            12,
          );

        expect(
          binaryMaskIou(
            mask,
            mask,
          ),
        ).toBe(1);

        expect(
          davisBoundaryF(
            mask,
            mask,
            16,
            16,
          ),
        ).toBe(1);
      },
    );

    test(
      "uses DAVIS boundary tolerance for a one-pixel shift",
      () => {
        const left =
          square(
            16,
            16,
            4,
            4,
            10,
            10,
          );

        const shifted =
          square(
            16,
            16,
            5,
            4,
            11,
            10,
          );

        expect(
          binaryMaskIou(
            left,
            shifted,
          ),
        ).toBeLessThan(
          1,
        );

        expect(
          davisBoundaryF(
            left,
            shifted,
            16,
            16,
          ),
        ).toBe(1);
      },
    );

    test(
      "returns zero for distant non-empty boundaries",
      () => {
        const left =
          square(
            32,
            32,
            2,
            2,
            8,
            8,
          );

        const right =
          square(
            32,
            32,
            22,
            22,
            28,
            28,
          );

        expect(
          davisBoundaryF(
            left,
            right,
            32,
            32,
          ),
        ).toBe(0);
      },
    );

    test(
      "matches DAVIS empty-mask behavior",
      () => {
        const empty =
          new Uint8Array(
            16 *
              16,
          );

        const foreground =
          square(
            16,
            16,
            4,
            4,
            12,
            12,
          );

        expect(
          davisBoundaryF(
            empty,
            empty,
            16,
            16,
          ),
        ).toBe(1);

        expect(
          davisBoundaryF(
            empty,
            foreground,
            16,
            16,
          ),
        ).toBe(0);

        expect(
          davisBoundaryF(
            foreground,
            empty,
            16,
            16,
          ),
        ).toBe(0);
      },
    );
  },
);
