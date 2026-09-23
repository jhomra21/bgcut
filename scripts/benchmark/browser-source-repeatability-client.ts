import { Schema } from "effect";

const StrategySchema = Schema.Literal(
  "current",
  "bitmap-no-color-conversion",
  "html-image-srgb-canvas",
);

const ConfigSchema = Schema.Struct({
  caseId: Schema.String,
  inputUrl: Schema.String,
  runs: Schema.Number,
  strategies: Schema.Array(
    StrategySchema,
  ),
});

type Strategy =
  Schema.Schema.Type<
    typeof StrategySchema
  >;

type SrgbCanvas = {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
};

type RunRecord = {
  readonly schemaVersion: 1;
  readonly strategy: Strategy;
  readonly run: number;
  readonly width: number;
  readonly height: number;
  readonly elapsedMs: number;
};

type StrategyReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly caseId: string;
  readonly strategy: Strategy;
  readonly runs: readonly RunRecord[];
};

const status =
  document.querySelector<HTMLPreElement>(
    "#status",
  );

if (
  status === null
) {
  throw new Error(
    "Source-repeatability status element is missing.",
  );
}

const writeStatus = (
  message: string,
): void => {
  status.textContent +=
    `${message}\n`;
};

const createSrgbCanvas = (
  width: number,
  height: number,
): SrgbCanvas => {
  const canvas =
    document.createElement(
      "canvas",
    );

  canvas.width = width;
  canvas.height = height;

  const context =
    canvas.getContext(
      "2d",
      {
        colorSpace:
          "srgb",
      },
    );

  if (
    context === null
  ) {
    throw new Error(
      "2D canvas is unavailable.",
    );
  }

  return {
    canvas,
    context,
  };
};

const renderBitmap = async (
  source: Blob,
  strategy: Extract<
    Strategy,
    | "current"
    | "bitmap-no-color-conversion"
  >,
): Promise<HTMLCanvasElement> => {
  const bitmap =
    await createImageBitmap(
      source,
      strategy === "current"
        ? {
            imageOrientation:
              "from-image",
          }
        : {
            imageOrientation:
              "from-image",
            colorSpaceConversion:
              "none",
          },
    );

  try {
    const {
      canvas,
      context,
    } =
      createSrgbCanvas(
        bitmap.width,
        bitmap.height,
      );

    context.drawImage(
      bitmap,
      0,
      0,
    );

    return canvas;
  } finally {
    bitmap.close();
  }
};

const loadHtmlImage = (
  source: Blob,
): Promise<HTMLImageElement> =>
  new Promise(
    (
      resolve,
      reject,
    ) => {
      const url =
        URL.createObjectURL(
          source,
        );

      const image =
        new Image();

      const cleanup =
        (): void => {
          URL.revokeObjectURL(
            url,
          );
        };

      image.addEventListener(
        "load",
        () => {
          cleanup();
          resolve(image);
        },
        {
          once: true,
        },
      );

      image.addEventListener(
        "error",
        () => {
          cleanup();
          reject(
            new Error(
              "HTML image decode failed.",
            ),
          );
        },
        {
          once: true,
        },
      );

      image.decoding =
        "async";

      image.src =
        url;
    },
  );

const renderHtmlImage =
  async (
    source: Blob,
  ): Promise<HTMLCanvasElement> => {
    const image =
      await loadHtmlImage(
        source,
      );

    const {
      canvas,
      context,
    } =
      createSrgbCanvas(
        image.naturalWidth,
        image.naturalHeight,
      );

    context.drawImage(
      image,
      0,
      0,
    );

    return canvas;
  };

const renderSource = async (
  source: Blob,
  strategy: Strategy,
): Promise<HTMLCanvasElement> => {
  if (
    strategy ===
    "html-image-srgb-canvas"
  ) {
    return renderHtmlImage(
      source,
    );
  }

  return renderBitmap(
    source,
    strategy,
  );
};

const canvasToPng = (
  canvas: HTMLCanvasElement,
): Promise<Blob> =>
  new Promise(
    (
      resolve,
      reject,
    ) => {
      canvas.toBlob(
        (blob) => {
          if (
            blob === null
          ) {
            reject(
              new Error(
                "PNG encoding returned no blob.",
              ),
            );

            return;
          }

          resolve(blob);
        },
        "image/png",
      );
    },
  );

const upload = async (
  strategy: Strategy,
  run: number,
  blob: Blob,
): Promise<void> => {
  const response =
    await fetch(
      `/output/${strategy}/${run}`,
      {
        method: "POST",
        body: blob,
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

const main =
  async (): Promise<void> => {
    const configResponse =
      await fetch(
        "/config.json",
      );

    if (
      !configResponse.ok
    ) {
      throw new Error(
        `Could not load source-repeatability config: HTTP ${configResponse.status}.`,
      );
    }

    const config =
      Schema.decodeUnknownSync(
        ConfigSchema,
      )(
        await configResponse.json(),
      );

    const inputResponse =
      await fetch(
        config.inputUrl,
        {
          cache:
            "no-store",
        },
      );

    if (
      !inputResponse.ok
    ) {
      throw new Error(
        `Could not load ${config.caseId}: HTTP ${inputResponse.status}.`,
      );
    }

    const source =
      await inputResponse.blob();

    for (
      const strategy of
        config.strategies
    ) {
      const runs:
        RunRecord[] = [];

      for (
        let run = 1;
        run <=
        config.runs;
        run += 1
      ) {
        const startedAt =
          performance.now();

        const canvas =
          await renderSource(
            source,
            strategy,
          );

        const blob =
          await canvasToPng(
            canvas,
          );

        await upload(
          strategy,
          run,
          blob,
        );

        const record:
          RunRecord = {
            schemaVersion: 1,
            strategy,
            run,
            width:
              canvas.width,
            height:
              canvas.height,
            elapsedMs:
              performance.now() -
              startedAt,
          };

        runs.push(
          record,
        );

        writeStatus(
          `${strategy} run ${run}: ${record.elapsedMs.toFixed(
            1,
          )} ms.`,
        );
      }

      const report:
        StrategyReport = {
          schemaVersion: 1,
          generatedAt:
            new Date().toISOString(),
          userAgent:
            navigator.userAgent,
          caseId:
            config.caseId,
          strategy,
          runs,
        };

      const response =
        await fetch(
          "/strategy-report",
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body:
              JSON.stringify(
                report,
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
    }

    const finalize =
      await fetch(
        "/finalize",
        {
          method: "POST",
        },
      );

    if (
      !finalize.ok
    ) {
      throw new Error(
        await finalize.text(),
      );
    }

    writeStatus("");
    writeStatus(
      "Source-repeatability benchmark passed.",
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

    writeStatus("");
    writeStatus(
      "SOURCE-REPEATABILITY BENCHMARK FAILED",
    );
    writeStatus(
      parsed.message,
    );
  },
);
