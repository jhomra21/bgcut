const VIDEO_REVISION =
  "06c7e6d99d6a7ddc7edbeaa6be838316feb70989";

const MASK_REVISION =
  "3c33c32";

const VIDEO_BASE =
  `https://huggingface.co/datasets/emirkisa/DAVIS-2017-480p-mp4/resolve/${VIDEO_REVISION}`;

const MASK_BASE =
  `https://huggingface.co/datasets/AlonzoLeeeooo/DAVIS-Edit/resolve/${MASK_REVISION}/Annotations`;

const fixture = (
  id: string,
  videoBytes?:
    number,
) => ({
  label:
    `DAVIS ${id}`,
  videoBytes,
});

export const QUALITY_FIXTURES = {
  "bike-packing":
    fixture(
      "bike-packing",
    ),
  blackswan:
    fixture(
      "blackswan",
      1_402_975,
    ),
  "bmx-trees":
    fixture(
      "bmx-trees",
      2_510_103,
    ),
  breakdance:
    fixture(
      "breakdance",
    ),
  camel:
    fixture(
      "camel",
      2_139_134,
    ),
  "car-roundabout":
    fixture(
      "car-roundabout",
    ),
  "car-shadow":
    fixture(
      "car-shadow",
      893_950,
    ),
  cows:
    fixture(
      "cows",
      3_309_913,
    ),
  "dance-twirl":
    fixture(
      "dance-twirl",
    ),
  dog:
    fixture(
      "dog",
    ),
  "dogs-jump":
    fixture(
      "dogs-jump",
    ),
  "drift-chicane":
    fixture(
      "drift-chicane",
    ),
  "drift-straight":
    fixture(
      "drift-straight",
    ),
  goat:
    fixture(
      "goat",
    ),
  "gold-fish":
    fixture(
      "gold-fish",
    ),
  "horsejump-high":
    fixture(
      "horsejump-high",
    ),
  india:
    fixture(
      "india",
    ),
  judo:
    fixture(
      "judo",
    ),
  "kite-surf":
    fixture(
      "kite-surf",
    ),
  "lab-coat":
    fixture(
      "lab-coat",
    ),
  libby:
    fixture(
      "libby",
    ),
  loading:
    fixture(
      "loading",
    ),
  "mbike-trick":
    fixture(
      "mbike-trick",
    ),
  "motocross-jump":
    fixture(
      "motocross-jump",
    ),
  "paragliding-launch":
    fixture(
      "paragliding-launch",
    ),
  parkour:
    fixture(
      "parkour",
    ),
  pigs:
    fixture(
      "pigs",
    ),
  "scooter-black":
    fixture(
      "scooter-black",
    ),
  shooting:
    fixture(
      "shooting",
    ),
  soapbox:
    fixture(
      "soapbox",
    ),

  // Extra diagnostic sequences retained from the earlier seven-clip bake-off.
  bear:
    fixture(
      "bear",
      2_015_436,
    ),
  "car-turn":
    fixture(
      "car-turn",
      2_318_304,
    ),
} as const;

export type QualityFixtureId =
  keyof typeof QUALITY_FIXTURES;

export const DAVIS_2017_VALIDATION_FIXTURES = [
  "bike-packing",
  "blackswan",
  "bmx-trees",
  "breakdance",
  "camel",
  "car-roundabout",
  "car-shadow",
  "cows",
  "dance-twirl",
  "dog",
  "dogs-jump",
  "drift-chicane",
  "drift-straight",
  "goat",
  "gold-fish",
  "horsejump-high",
  "india",
  "judo",
  "kite-surf",
  "lab-coat",
  "libby",
  "loading",
  "mbike-trick",
  "motocross-jump",
  "paragliding-launch",
  "parkour",
  "pigs",
  "scooter-black",
  "shooting",
  "soapbox",
] as const satisfies
  readonly QualityFixtureId[];

export const QUALITY_FRAME_COUNT =
  12;

export const QUALITY_FRAME_RATE =
  24;

export const isQualityFixtureId = (
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

export type QualityFixtureProxyOptions = {
  readonly maskRoot?:
    string;
};

export const proxyQualityFixtureRequest =
  async (
    request: Request,
    options:
      QualityFixtureProxyOptions = {},
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

    if (
      options.maskRoot !==
      undefined
    ) {
      const path =
        `${options.maskRoot}/${id}/${filename}`;

      const file =
        Bun.file(
          path,
        );

      if (
        !(await file.exists())
      ) {
        throw new Error(
          `DAVIS quality mask is missing at ${path}.`,
        );
      }

      return new Response(
        file,
        {
          headers: {
            "content-type":
              "image/png",
            "cache-control":
              "no-store",
            "content-length":
              String(
                file.size,
              ),
          },
        },
      );
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
