import {
  gunzipSync,
} from "node:zlib";

import {
  EDGETAM_RELEASE_FILES,
  edgeTamProxyFilename,
  edgeTamReleaseUrl,
} from "./model-delivery";

const cache =
  new Map<
    string,
    Promise<Uint8Array<ArrayBuffer>>
  >();

const loadReleaseFile =
  async (
    filename:
      keyof typeof EDGETAM_RELEASE_FILES,
  ): Promise<Uint8Array<ArrayBuffer>> => {
    const existing =
      cache.get(
        filename,
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
            edgeTamReleaseUrl(
              filename,
            ),
          );

        if (
          !response.ok
        ) {
          throw new Error(
            `Could not fetch EdgeTAM release file ${filename}: HTTP ${response.status}.`,
          );
        }

        const compressed =
          new Uint8Array(
            await response.arrayBuffer(),
          );

        const inflated =
          gunzipSync(
            compressed,
          );

        const bytes =
          new Uint8Array(
            inflated.buffer.slice(
              inflated.byteOffset,
              inflated.byteOffset +
                inflated.byteLength,
            ),
          );

        const expected =
          EDGETAM_RELEASE_FILES[
            filename
          ].rawBytes;

        if (
          bytes.byteLength !==
          expected
        ) {
          throw new Error(
            `EdgeTAM release file ${filename} was ${bytes.byteLength} bytes after decompression; expected ${expected}.`,
          );
        }

        return bytes;
      })();

    cache.set(
      filename,
      pending,
    );

    try {
      return await pending;
    } catch (error) {
      cache.delete(
        filename,
      );

      throw error;
    }
  };

export const proxyVideoModelRequest =
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

    const filename =
      edgeTamProxyFilename(
        url.pathname,
      );

    if (
      filename === null
    ) {
      return null;
    }

    const bytes =
      await loadReleaseFile(
        filename,
      );

    return new Response(
      bytes,
      {
        headers: {
          "content-type":
            filename.endsWith(
              ".json",
            )
              ? "application/json; charset=utf-8"
              : "application/octet-stream",
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
