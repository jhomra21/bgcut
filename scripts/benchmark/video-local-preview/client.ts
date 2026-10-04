import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
} from "mediabunny";

import {
  removeVideoBackgroundExperimental,
} from "../../src/browser/video-experimental";

type PreviewReport = {
  readonly schemaVersion: 1;
  readonly blobBytes: number;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly duration: number;
  readonly sampleFps: number;
  readonly seed: string;
  readonly transparentPixels: number;
  readonly opaqueOrPartialPixels: number;
};

const postJson = async (
  path: string,
  value: unknown,
) => {
  const response =
    await fetch(
      path,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify(
            value,
          ),
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      await response.text(),
    );
  }
};

const verifyAlpha = async (
  blob: Blob,
): Promise<{
  readonly transparentPixels:
    number;
  readonly opaqueOrPartialPixels:
    number;
}> => {
  const input =
    new Input({
      source:
        new BlobSource(
          blob,
        ),
      formats:
        ALL_FORMATS,
    });

  try {
    const track =
      await input.getPrimaryVideoTrack();

    if (
      track ===
      null
    ) {
      throw new Error(
        "Exported WebM has no video track.",
      );
    }

    const firstTimestamp =
      await track.getFirstTimestamp();

    const sink =
      new CanvasSink(
        track,
        {
          alpha: true,
        },
      );

    const wrapped =
      await sink.getCanvas(
        firstTimestamp,
      );

    if (
      wrapped ===
      null
    ) {
      throw new Error(
        "Exported WebM could not decode its first frame.",
      );
    }

    const context =
      wrapped.canvas.getContext(
        "2d",
      );

    if (
      context ===
      null
    ) {
      throw new Error(
        "Could not inspect exported WebM alpha.",
      );
    }

    const pixels =
      context.getImageData(
        0,
        0,
        wrapped.canvas.width,
        wrapped.canvas.height,
      ).data;

    let transparentPixels = 0;
    let opaqueOrPartialPixels = 0;

    for (
      let offset = 3;
      offset <
      pixels.length;
      offset += 4
    ) {
      const alpha =
        pixels[offset] ??
        255;

      if (
        alpha <
        255
      ) {
        transparentPixels +=
          1;
      }

      if (
        alpha >
        0
      ) {
        opaqueOrPartialPixels +=
          1;
      }
    }

    if (
      transparentPixels ===
      0
    ) {
      throw new Error(
        "Exported WebM decoded as fully opaque.",
      );
    }

    if (
      opaqueOrPartialPixels ===
      0
    ) {
      throw new Error(
        "Exported WebM decoded as fully transparent.",
      );
    }

    return {
      transparentPixels,
      opaqueOrPartialPixels,
    };
  } finally {
    input.dispose();
  }
};

const main =
  async () => {
    const response =
      await fetch(
        "/fixture.mp4",
        {
          cache:
            "no-store",
        },
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Could not load preview fixture: HTTP ${response.status}.`,
      );
    }

    const fixture =
      new File(
        [
          await response.blob(),
        ],
        "fixture.mp4",
        {
          type:
            "video/mp4",
        },
      );

    const result =
      await removeVideoBackgroundExperimental(
        fixture,
      );

    if (
      result.blob.size <
      1_000
    ) {
      throw new Error(
        `Transparent WebM is unexpectedly small at ${result.blob.size} bytes.`,
      );
    }

    const alpha =
      await verifyAlpha(
        result.blob,
      );

    const outputResponse =
      await fetch(
        "/output.webm",
        {
          method: "POST",
          body:
            result.blob,
        },
      );

    if (
      !outputResponse.ok
    ) {
      throw new Error(
        await outputResponse.text(),
      );
    }

    const report:
      PreviewReport = {
        schemaVersion: 1,
        blobBytes:
          result.blob.size,
        width:
          result.width,
        height:
          result.height,
        frameCount:
          result.frameCount,
        duration:
          result.duration,
        sampleFps:
          result.sampleFps,
        seed:
          result.seed,
        ...alpha,
      };

    await postJson(
      "/result",
      report,
    );
  };

void main().catch(
  (error) => {
    const parsed =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    void postJson(
      "/failure",
      {
        schemaVersion: 1,
        message:
          parsed.message,
        stack:
          parsed.stack ??
          "",
      },
    );
  },
);
