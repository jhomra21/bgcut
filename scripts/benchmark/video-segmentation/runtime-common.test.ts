import {
  describe,
  expect,
  test,
} from "bun:test";

import {
  channelsToTokens,
  concatenateFloat32,
  temporalPositions,
  tokensToChannels,
} from "./runtime-common";

describe(
  "video segmentation runtime helpers",
  () => {
    test(
      "round-trips channel-first features through token-major memory layout",
      () => {
        const channels =
          new Float32Array([
            1,
            2,
            3,
            10,
            20,
            30,
          ]);

        const tokens =
          channelsToTokens(
            channels,
            2,
            3,
          );

        expect(
          [...tokens],
        ).toEqual([
          1,
          10,
          2,
          20,
          3,
          30,
        ]);

        expect([
          ...tokensToChannels(
            tokens,
            2,
            3,
          ),
        ]).toEqual([
          ...channels,
        ]);
      },
    );

    test(
      "adds one temporal row across every memory token",
      () => {
        const positioned =
          temporalPositions(
            new Float32Array([
              1,
              2,
              3,
              4,
            ]),
            [
              10,
              20,
            ],
            2,
          );

        expect([
          ...positioned,
        ]).toEqual([
          11,
          22,
          13,
          24,
        ]);
      },
    );

    test(
      "concatenates memory blocks without changing block order",
      () => {
        expect([
          ...concatenateFloat32([
            new Float32Array([
              1,
              2,
            ]),
            new Float32Array([
              3,
            ]),
          ]),
        ]).toEqual([
          1,
          2,
          3,
        ]);
      },
    );
  },
);
