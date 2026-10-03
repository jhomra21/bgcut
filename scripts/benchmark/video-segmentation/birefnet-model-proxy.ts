import {
  MODEL_PUBLIC_PATH,
  MODEL_RELEASE_URL,
  MODEL_SIZE_BYTES,
} from "../../../src/shared/model-config";

let cached:
  Promise<
    Uint8Array<ArrayBuffer>
  > |
  undefined;

const loadModel =
  async (): Promise<
    Uint8Array<ArrayBuffer>
  > => {
    if (
      cached !==
      undefined
    ) {
      return cached;
    }

    const pending =
      (async () => {
        const response =
          await fetch(
            MODEL_RELEASE_URL,
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
          MODEL_SIZE_BYTES
        ) {
          throw new Error(
            `BiRefNet seed model was ${bytes.byteLength} bytes; expected ${MODEL_SIZE_BYTES}.`,
          );
        }

        return bytes;
      })();

    cached =
      pending;

    try {
      return await pending;
    } catch (error) {
      cached =
        undefined;

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

    if (
      url.pathname !==
      MODEL_PUBLIC_PATH
    ) {
      return null;
    }

    const bytes =
      await loadModel();

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
