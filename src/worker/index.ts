import {
  MODEL_FILENAME,
  WEBGPU_MODEL_FILENAME,
} from "../shared/model-config.ts";
import {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WEBGPU_WASM_FILENAME,
} from "../shared/ort-assets.ts";
import { PUBLIC_SITE_PAGES, SITE_PAGE_METADATA } from "../shared/site-metadata.ts";
import type { AssetFetcher, R2BucketBinding, R2ObjectMetadata } from "./types.ts";

const MODEL_PATH = `/models/${MODEL_FILENAME}`;

const WEBGPU_MODEL_PATH = `/models/${WEBGPU_MODEL_FILENAME}`;

const ORT_WEBGPU_WASM_PATH = `/runtime/${ORT_WEBGPU_WASM_FILENAME}`;

const ORT_WASM_PATH = `/runtime/${ORT_WASM_FILENAME}`;

const ORT_WASM_MODULE_PATH = `/runtime/${ORT_WASM_MODULE_FILENAME}`;

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const PUBLIC_SITE_PATHS = new Set(
  PUBLIC_SITE_PAGES.map((page) => SITE_PAGE_METADATA[page].path),
);

const STATIC_ROUTE_REDIRECTS = new Map(
  PUBLIC_SITE_PAGES
    .filter((page) => page !== "home")
    .map((page) => [`${SITE_PAGE_METADATA[page].path}.html`, SITE_PAGE_METADATA[page].path]),
);

const normalizedSitePath = (pathname: string): string =>
  pathname === "/" ? "/" : pathname.replace(/\/+$/u, "");

const siteNavigationResponse = (request: Request, url: URL): Response | undefined => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return undefined;
  }

  const staticRoute = STATIC_ROUTE_REDIRECTS.get(url.pathname);

  if (url.pathname === "/index.html" || staticRoute !== undefined) {
    const redirect = new URL(url);
    redirect.pathname = staticRoute ?? "/";

    return Response.redirect(redirect, 308);
  }

  const normalizedPath = normalizedSitePath(url.pathname);

  if (PUBLIC_SITE_PATHS.has(normalizedPath)) {
    if (url.pathname !== normalizedPath) {
      const redirect = new URL(url);
      redirect.pathname = normalizedPath;

      return Response.redirect(redirect, 308);
    }

    return undefined;
  }

  const finalSegment = normalizedPath.split("/").at(-1) ?? "";

  if (finalSegment.includes(".")) {
    return undefined;
  }

  return new Response("Page not found.", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
};

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

  if (pathname === WEBGPU_MODEL_PATH) {
    return {
      key: WEBGPU_MODEL_FILENAME,
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

const objectHeaders = (object: R2ObjectMetadata, contentType: string): Headers => {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", IMMUTABLE_CACHE_CONTROL);
  headers.set("content-length", String(object.size));
  headers.set("content-type", contentType);
  headers.set("etag", object.httpEtag);

  return headers;
};

type Env = {
  readonly ASSETS: AssetFetcher;
  readonly MODELS: R2BucketBinding;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const asset = resolveR2Asset(url.pathname);

    if (asset === undefined) {
      const navigationResponse = siteNavigationResponse(request, url);

      if (navigationResponse !== undefined) {
        return navigationResponse;
      }

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
