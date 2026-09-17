import { MODEL_FILENAME } from "../src/engine/model-config.ts";

const MODEL_PATH = `/models/${MODEL_FILENAME}`;

const MODEL_CACHE_CONTROL = "public, max-age=31536000, immutable";

const modelHeaders = (object: R2Object): Headers => {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", MODEL_CACHE_CONTROL);
  headers.set("content-length", String(object.size));
  headers.set("etag", object.httpEtag);

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }

  return headers;
};

type Env = {
  readonly ASSETS: Fetcher;
  readonly MODELS: R2Bucket;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== MODEL_PATH) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "HEAD") {
      const object = await env.MODELS.head(MODEL_FILENAME);

      if (object === null) {
        return new Response("Model not found.", { status: 404 });
      }

      return new Response(null, { headers: modelHeaders(object) });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed.", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const object = await env.MODELS.get(MODEL_FILENAME);

    if (object === null) {
      return new Response("Model not found.", { status: 404 });
    }

    return new Response(object.body, { headers: modelHeaders(object) });
  },
};
