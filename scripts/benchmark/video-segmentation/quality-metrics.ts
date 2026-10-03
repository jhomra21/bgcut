const countSet = (
  values: Uint8Array,
): number => {
  let count = 0;

  for (
    const value of
    values
  ) {
    if (
      value !==
      0
    ) {
      count += 1;
    }
  }

  return count;
};

const segmentationBoundary = (
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array => {
  if (
    mask.length !==
    width *
      height
  ) {
    throw new Error(
      "Boundary mask geometry does not match its dimensions.",
    );
  }

  const boundary =
    new Uint8Array(
      mask.length,
    );

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      if (
        y ===
          height - 1 &&
        x ===
          width - 1
      ) {
        continue;
      }

      const index =
        y *
          width +
        x;

      const current =
        mask[index] !==
        0;

      if (
        y ===
        height - 1
      ) {
        boundary[index] =
          current !==
          (
            mask[
              index + 1
            ] !== 0
          )
            ? 1
            : 0;

        continue;
      }

      if (
        x ===
        width - 1
      ) {
        boundary[index] =
          current !==
          (
            mask[
              index +
                width
            ] !== 0
          )
            ? 1
            : 0;

        continue;
      }

      const east =
        mask[
          index + 1
        ] !== 0;

      const south =
        mask[
          index +
            width
        ] !== 0;

      const southeast =
        mask[
          index +
            width +
            1
        ] !== 0;

      boundary[index] =
        (
          current !==
            east ||
          current !==
            south ||
          current !==
            southeast
        )
          ? 1
          : 0;
    }
  }

  return boundary;
};

const dilateDisk = (
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array => {
  const result =
    new Uint8Array(
      mask.length,
    );

  const squaredRadius =
    radius *
    radius;

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      if (
        mask[
          y *
            width +
            x
        ] ===
        0
      ) {
        continue;
      }

      const minY =
        Math.max(
          0,
          y -
            radius,
        );

      const maxY =
        Math.min(
          height - 1,
          y +
            radius,
        );

      const minX =
        Math.max(
          0,
          x -
            radius,
        );

      const maxX =
        Math.min(
          width - 1,
          x +
            radius,
        );

      for (
        let targetY =
          minY;
        targetY <=
        maxY;
        targetY += 1
      ) {
        const dy =
          targetY -
          y;

        for (
          let targetX =
            minX;
          targetX <=
          maxX;
          targetX += 1
        ) {
          const dx =
            targetX -
            x;

          if (
            dx * dx +
              dy * dy >
            squaredRadius
          ) {
            continue;
          }

          result[
            targetY *
              width +
              targetX
          ] = 1;
        }
      }
    }
  }

  return result;
};

export const binaryMaskIou = (
  prediction:
    Uint8Array,
  expected:
    Uint8Array,
): number => {
  if (
    prediction.length !==
    expected.length
  ) {
    throw new Error(
      "IoU masks have different lengths.",
    );
  }

  let intersection = 0;

  let union = 0;

  for (
    let index = 0;
    index <
    prediction.length;
    index += 1
  ) {
    const predicted =
      prediction[index] !==
      0;

    const target =
      expected[index] !==
      0;

    if (
      predicted &&
      target
    ) {
      intersection += 1;
    }

    if (
      predicted ||
      target
    ) {
      union += 1;
    }
  }

  return union ===
    0
    ? 1
    : intersection /
      union;
};

export const davisBoundaryF = (
  prediction:
    Uint8Array,
  expected:
    Uint8Array,
  width: number,
  height: number,
  threshold = 0.008,
): number => {
  if (
    prediction.length !==
      expected.length ||
    prediction.length !==
      width *
        height
  ) {
    throw new Error(
      "Boundary F masks do not match their dimensions.",
    );
  }

  const boundPixels =
    Math.max(
      0,
      Math.ceil(
        threshold >=
          1
          ? threshold
          : threshold *
              Math.hypot(
                height,
                width,
              ),
      ),
    );

  const predictionBoundary =
    segmentationBoundary(
      prediction,
      width,
      height,
    );

  const expectedBoundary =
    segmentationBoundary(
      expected,
      width,
      height,
    );

  const predictionDilated =
    dilateDisk(
      predictionBoundary,
      width,
      height,
      boundPixels,
    );

  const expectedDilated =
    dilateDisk(
      expectedBoundary,
      width,
      height,
      boundPixels,
    );

  let predictionMatches = 0;

  let expectedMatches = 0;

  for (
    let index = 0;
    index <
    prediction.length;
    index += 1
  ) {
    if (
      predictionBoundary[
        index
      ] !==
        0 &&
      expectedDilated[
        index
      ] !==
        0
    ) {
      predictionMatches += 1;
    }

    if (
      expectedBoundary[
        index
      ] !==
        0 &&
      predictionDilated[
        index
      ] !==
        0
    ) {
      expectedMatches += 1;
    }
  }

  const predictionCount =
    countSet(
      predictionBoundary,
    );

  const expectedCount =
    countSet(
      expectedBoundary,
    );

  let precision: number;

  let recall: number;

  if (
    predictionCount ===
      0 &&
    expectedCount >
      0
  ) {
    precision = 1;
    recall = 0;
  } else if (
    predictionCount >
      0 &&
    expectedCount ===
      0
  ) {
    precision = 0;
    recall = 1;
  } else if (
    predictionCount ===
      0 &&
    expectedCount ===
      0
  ) {
    precision = 1;
    recall = 1;
  } else {
    precision =
      predictionMatches /
      predictionCount;

    recall =
      expectedMatches /
      expectedCount;
  }

  return precision +
    recall ===
    0
    ? 0
    : (
        2 *
        precision *
        recall
      ) /
        (
          precision +
          recall
        );
};
