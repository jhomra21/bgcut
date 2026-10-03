import {
  describe,
  expect,
  test,
} from "bun:test";

import {
  EDGETAM_RELEASE_BASE,
  browserVideoModelUrl,
  edgeTamProxyFilename,
  edgeTamReleaseUrl,
} from "./model-delivery";

describe(
  "video model delivery",
  () => {
    test(
      "keeps the immutable EdgeTAM source URL in metadata but uses a same-origin benchmark URL in the browser",
      () => {
        const source =
          edgeTamReleaseUrl(
            "parameters.json",
          );

        expect(
          source,
        ).toBe(
          `${EDGETAM_RELEASE_BASE}/parameters.json.gz`,
        );

        expect(
          browserVideoModelUrl(
            source,
          ),
        ).toBe(
          "/video-model/edgetam-v1/parameters.json",
        );
      },
    );

    test(
      "does not proxy unknown release paths or unrelated model hosts",
      () => {
        expect(
          edgeTamProxyFilename(
            "/video-model/edgetam-v1/not-a-model.bin",
          ),
        ).toBeNull();

        expect(
          browserVideoModelUrl(
            "https://huggingface.co/example/model.onnx",
          ),
        ).toBe(
          "https://huggingface.co/example/model.onnx",
        );
      },
    );
  },
);
