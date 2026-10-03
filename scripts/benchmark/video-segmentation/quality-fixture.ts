const VIDEO_REVISION =
  "06c7e6d99d6a7ddc7edbeaa6be838316feb70989";

const MASK_REVISION =
  "3c33c32";

const VIDEO_URL =
  `https://huggingface.co/datasets/emirkisa/DAVIS-2017-480p-mp4/resolve/${VIDEO_REVISION}/blackswan_raw_24fps.mp4`;

const MASK_BASE =
  `https://huggingface.co/datasets/AlonzoLeeeooo/DAVIS-Edit/resolve/${MASK_REVISION}/Annotations/blackswan`;

const VIDEO_BYTES =
  1_402_975;

const FRAME_COUNT =
  12;

const VIDEO_ROUTE =
  "/quality/blackswan.mp4";

const MASK_ROUTE_PREFIX =
  "/quality/blackswan/";

const cache =
  new Map<
    string,
    Promise<Uint8Array<ArrayBuffer>>
  >();

const load = async (
  key: string,
  source: string,
  expectedBytes?:
    number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const existing =
    cache.get(
      key,
    );

  if (
    existing !==
    undefined
  ) {
    return existing;
  }

  const pending =
    (async () => {
      const response =
        await fetch(
          source,
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `Could not fetch DAVIS quality fixture ${key}: HTTP ${response.status}.`,
        );
      }

      const bytes =
        new Uint8Array(
          await response.arrayBuffer(),
        );

      if (
        expectedBytes !==
          undefined &&
        bytes.byteLength !==
          expectedBytes
      ) {
        throw new Error(
          `DAVIS quality fixture ${key} was ${bytes.byteLength} bytes; expected ${expectedBytes}.`,
        );
      }

      return bytes;
    })();

  cache.set(
    key,
    pending,
  );

  try {
    return await pending;
  } catch (error) {
    cache.delete(
      key,
    );

    throw error;
  }
};

const frameFilename = (
  index: number,
): string =>
  `${index.toString().padStart(
    5,
    "0",
  )}.png`;

export const QUALITY_FRAME_COUNT =
  FRAME_COUNT;

export const QUALITY_FRAME_RATE =
  24;

export const proxyQualityFixtureRequest =
  async (
    request: Request,
  ): Promise<Response | null> => {
    if (
      request.method !==
      "GET"
    ) {
      return null;
    }

    const url =
      new URL(
        request.url,
      );

    if (
      url.pathname ===
      VIDEO_ROUTE
    ) {
      const bytes =
        await load(
          "blackswan_raw_24fps.mp4",
          VIDEO_URL,
          VIDEO_BYTES,
        );

      return new Response(
        bytes,
        {
          headers: {
            "content-type":
              "video/mp4",
            "cache-control":
              "public, max-age=31536000, immutable",
            "content-length":
              String(
                bytes.byteLength,
              ),
          },
        },
      );
    }

    if (
      !url.pathname.startsWith(
        MASK_ROUTE_PREFIX,
      )
    ) {
      return null;
    }

    const filename =
      url.pathname.slice(
        MASK_ROUTE_PREFIX.length,
      );

    const match =
      /^(\d{5})\.png$/u.exec(
        filename,
      );

    if (
      match ===
      null
    ) {
      return null;
    }

    const index =
      Number.parseInt(
        match[1] ??
          "",
        10,
      );

    if (
      index < 0 ||
      index >=
        FRAME_COUNT
    ) {
      return null;
    }

    const expected =
      frameFilename(
        index,
      );

    if (
      expected !==
      filename
    ) {
      return null;
    }

    const bytes =
      await load(
        filename,
        `${MASK_BASE}/${filename}`,
      );

    return new Response(
      bytes,
      {
        headers: {
          "content-type":
            "image/png",
          "cache-control":
            "public, max-age=31536000, immutable",
          "content-length":
            String(
              bytes.byteLength,
            ),
        },
      },
    );
  };
