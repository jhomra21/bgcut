const VIDEO_REVISION =
  "06c7e6d99d6a7ddc7edbeaa6be838316feb70989";

const MASK_REVISION =
  "3c33c32";

const VIDEO_BASE =
  `https://huggingface.co/datasets/emirkisa/DAVIS-2017-480p-mp4/resolve/${VIDEO_REVISION}`;

const MASK_BASE =
  `https://huggingface.co/datasets/AlonzoLeeeooo/DAVIS-Edit/resolve/${MASK_REVISION}/Annotations`;

export const QUALITY_FIXTURES = {
  blackswan: {
    label:
      "DAVIS blackswan",
    videoBytes:
      1_402_975,
  },
  bear: {
    label:
      "DAVIS bear",
    videoBytes:
      2_015_436,
  },
  camel: {
    label:
      "DAVIS camel",
    videoBytes:
      2_139_134,
  },
  cows: {
    label:
      "DAVIS cows",
    videoBytes:
      3_309_913,
  },
} as const;

export type QualityFixtureId =
  keyof typeof QUALITY_FIXTURES;

export const QUALITY_FRAME_COUNT =
  12;

export const QUALITY_FRAME_RATE =
  24;

const isQualityFixtureId = (
  value: string,
): value is QualityFixtureId =>
  Object.hasOwn(
    QUALITY_FIXTURES,
    value,
  );

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

export const qualityVideoRoute = (
  fixture:
    QualityFixtureId,
): string =>
  `/quality/${fixture}.mp4`;

export const qualityMaskRoute = (
  fixture:
    QualityFixtureId,
  index: number,
): string =>
  `/quality/${fixture}/${frameFilename(
    index,
  )}`;

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

    const videoMatch =
      /^\/quality\/([a-z0-9-]+)\.mp4$/u.exec(
        url.pathname,
      );

    if (
      videoMatch !==
      null
    ) {
      const id =
        videoMatch[1] ??
        "";

      if (
        !isQualityFixtureId(
          id,
        )
      ) {
        return null;
      }

      const fixture =
        QUALITY_FIXTURES[
          id
        ];

      const bytes =
        await load(
          `${id}_raw_24fps.mp4`,
          `${VIDEO_BASE}/${id}_raw_24fps.mp4`,
          fixture.videoBytes,
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

    const maskMatch =
      /^\/quality\/([a-z0-9-]+)\/(\d{5})\.png$/u.exec(
        url.pathname,
      );

    if (
      maskMatch ===
      null
    ) {
      return null;
    }

    const id =
      maskMatch[1] ??
      "";

    if (
      !isQualityFixtureId(
        id,
      )
    ) {
      return null;
    }

    const filename =
      `${maskMatch[2] ?? ""}.png`;

    const index =
      Number.parseInt(
        maskMatch[2] ??
          "",
        10,
      );

    if (
      index < 0 ||
      index >=
        QUALITY_FRAME_COUNT ||
      filename !==
        frameFilename(
          index,
        )
    ) {
      return null;
    }

    const bytes =
      await load(
        `${id}/${filename}`,
        `${MASK_BASE}/${id}/${filename}`,
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
