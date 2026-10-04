import {
  MODEL_PUBLIC_PATH,
  MODEL_RELEASE_URL,
  MODEL_SIZE_BYTES,
  WEBGPU_MODEL_PUBLIC_PATH,
  WEBGPU_MODEL_RELEASE_URL,
  WEBGPU_MODEL_SIZE_BYTES,
} from "../../../src/shared/model-config";

type BiRefNetModelSource = {
  readonly releaseUrl: string;
  readonly sizeBytes: number;
};

const sources =
  new Map<
    string,
    BiRefNetModelSource
  >([
    [
      MODEL_PUBLIC_PATH,
      {
        releaseUrl:
          MODEL_RELEASE_URL,
        sizeBytes:
          MODEL_SIZE_BYTES,
      },
    ],
    [
      WEBGPU_MODEL_PUBLIC_PATH,
      {
        releaseUrl:
          WEBGPU_MODEL_RELEASE_URL,
        sizeBytes:
          WEBGPU_MODEL_SIZE_BYTES,
      },
    ],
  ]);

const cached =
  new Map<
    string,
    Promise<
      Uint8Array<ArrayBuffer>
    >
  >();

const loadModel =
  async (
    path: string,
    source:
      BiRefNetModelSource,
  ): Promise<
    Uint8Array<ArrayBuffer>
  > => {
    const existing =
      cached.get(
        path,
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
            source.releaseUrl,
          );

        if (
          !response.ok
        ) {
          throw new Error(
            `Could not fetch the bgcut BiRefNet seed model: HTTP ${response.status}.`,
          );
        }

        const bytes =
          new Uint8Array(
            await response.arrayBuffer(),
          );

        if (
          bytes.byteLength !==
          source.sizeBytes
        ) {
          throw new Error(
            `BiRefNet seed model was ${bytes.byteLength} bytes; expected ${source.sizeBytes}.`,
          );
        }

        return bytes;
      })();

    cached.set(
      path,
      pending,
    );

    try {
      return await pending;
    } catch (error) {
      cached.delete(
        path,
      );

      throw error;
    }
  };

export const proxyBiRefNetSeedModelRequest =
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

    const source =
      sources.get(
        url.pathname,
      );

    if (
      source ===
      undefined
    ) {
      return null;
    }

    const bytes =
      await loadModel(
        url.pathname,
        source,
      );

    return new Response(
      bytes,
      {
        headers: {
          "content-type":
            "application/octet-stream",
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
