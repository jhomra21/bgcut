import {
  createEdgeTamAdapter,
} from "./edgetam-adapter";
import {
  createSam21Adapter,
} from "./sam21-adapter";

import type {
  VideoSegmentationAdapterFactory,
} from "./types";

export const createVideoSegmentationAdapter:
  VideoSegmentationAdapterFactory =
  (
    candidate,
    onProgress,
  ) => {
    switch (
      candidate.id
    ) {
      case "edgetam":
        return createEdgeTamAdapter(
          candidate,
          onProgress,
        );

      case "sam21-tiny":
        return createSam21Adapter(
          candidate,
          onProgress,
        );
    }
  };
