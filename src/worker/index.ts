import { MODEL_FILENAME } from "../engine/model-config.ts";
import {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WEBGPU_WASM_FILENAME,
} from "../engine/ort-webgpu-runtime.ts";

const MODEL_PATH = `/models/${MODEL_FILENAME}`;

const ORT_WEBGPU_WASM_PATH = `/runtime/${ORT_WEBGPU_WASM_FILENAME}`;

const ORT_WASM_PATH = `/runtime/${ORT_WASM_FILENAME}`;

const ORT_WASM_MODULE_PATH = `/runtime/${ORT_WASM_MODULE_FILENAME}`;

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type R2Asset = {
  readonly key: string;
  readonly contentType: string;
};

const resolveR2Asset = (pathname: string): R2Asset | undefined => {
  if (pathname === MODEL_PATH) {
    return {
      key: MODEL_FILENAME,
      contentType: "application/octet-stream",
    };
  }

  if (pathname === ORT_WEBGPU_WASM_PATH) {
    return {
      key: ORT_WEBGPU_WASM_FILENAME,
      contentType: "application/wasm",
    };
  }

  if (pathname === ORT_WASM_PATH) {
    return {
      key: ORT_WASM_FILENAME,
      contentType: "application/wasm",
    };
  }

  if (pathname === ORT_WASM_MODULE_PATH) {
    return {
      key: ORT_WASM_MODULE_FILENAME,
      contentType: "text/javascript; charset=utf-8",
    };
  }

  return undefined;
};

const objectHeaders = (object: R2Object, contentType: string): Headers => {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", IMMUTABLE_CACHE_CONTROL);
  headers.set("content-length", String(object.size));
  headers.set("content-type", contentType);
  headers.set("etag", object.httpEtag);

  return headers;
};

type Env = {
  readonly ASSETS: Fetcher;
  readonly MODELS: R2Bucket;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const asset = resolveR2Asset(url.pathname);

    if (asset === undefined) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "HEAD") {
      const object = await env.MODELS.head(asset.key);

      if (object === null) {
        return new Response("Asset not found.", { status: 404 });
      }

      return new Response(null, { headers: objectHeaders(object, asset.contentType) });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed.", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const object = await env.MODELS.get(asset.key);

    if (object === null) {
      return new Response("Asset not found.", { status: 404 });
    }

    return new Response(object.body, {
      headers: objectHeaders(object, asset.contentType),
    });
  },
};
