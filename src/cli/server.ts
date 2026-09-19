import { Effect } from "effect";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { MODEL_FILENAME } from "../engine/model-config";
import {
  ORT_WASM_FILENAME,
  ORT_WASM_MODULE_FILENAME,
  ORT_WEBGPU_WASM_FILENAME,
} from "../engine/ort-webgpu-runtime";
import { ensureCliModel } from "../native/model-cache";
import type { ServeOptions } from "./args";

const HOST = "127.0.0.1";

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const LOCAL_RUNTIME_META = '<meta name="bgcut-runtime" content="local" />';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const packageWebRoot = resolve(packageRoot, "dist/web");

const require = createRequire(import.meta.url);

const runtimeDirectory = dirname(require.resolve("onnxruntime-web"));

const runtimeAssets = new Map<string, { readonly path: string; readonly contentType: string }>([
  [
    `/runtime/${ORT_WEBGPU_WASM_FILENAME}`,
    {
      path: resolve(runtimeDirectory, ORT_WEBGPU_WASM_FILENAME),
      contentType: "application/wasm",
    },
  ],
  [
    `/runtime/${ORT_WASM_FILENAME}`,
    {
      path: resolve(runtimeDirectory, ORT_WASM_FILENAME),
      contentType: "application/wasm",
    },
  ],
  [
    `/runtime/${ORT_WASM_MODULE_FILENAME}`,
    {
      path: resolve(runtimeDirectory, ORT_WASM_MODULE_FILENAME),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
]);

const contentTypeForPath = (path: string): string => {
  const extension = extname(path).toLowerCase();

  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }

  if (extension === ".js" || extension === ".mjs") {
    return "text/javascript; charset=utf-8";
  }

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".json" || extension === ".webmanifest") {
    return "application/json; charset=utf-8";
  }

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".ico") {
    return "image/x-icon";
  }

  if (extension === ".wasm") {
    return "application/wasm";
  }

  return "application/octet-stream";
};

const sendFile = async (
  response: ServerResponse,
  path: string,
  options: {
    readonly method: string;
    readonly contentType?: string;
    readonly cacheControl?: string;
  },
): Promise<void> => {
  const file = await stat(path);

  response.statusCode = 200;
  response.setHeader("content-length", String(file.size));
  response.setHeader("content-type", options.contentType ?? contentTypeForPath(path));

  if (options.cacheControl !== undefined) {
    response.setHeader("cache-control", options.cacheControl);
  }

  if (options.method === "HEAD") {
    response.end();

    return;
  }

  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = createReadStream(path);

    stream.on("error", rejectStream);
    response.on("finish", resolveStream);
    response.on("error", rejectStream);
    stream.pipe(response);
  });
};

const sendLocalIndex = async (
  response: ServerResponse,
  path: string,
  method: string,
): Promise<void> => {
  const source = await readFile(path, "utf8");

  const html = source.includes(LOCAL_RUNTIME_META)
    ? source
    : source.includes("</head>")
      ? source.replace("</head>", `  ${LOCAL_RUNTIME_META}\n  </head>`)
      : `${LOCAL_RUNTIME_META}\n${source}`;

  const body = Buffer.from(html, "utf8");

  response.statusCode = 200;
  response.setHeader("cache-control", "no-cache");
  response.setHeader("content-length", String(body.byteLength));
  response.setHeader("content-type", "text/html; charset=utf-8");

  if (method === "HEAD") {
    response.end();

    return;
  }

  response.end(body);
};

const resolveStaticPath = async (pathname: string, webRoot: string): Promise<string> => {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const path = resolve(webRoot, `.${decodeURIComponent(requested)}`);
  const rootPrefix = webRoot.endsWith(sep) ? webRoot : `${webRoot}${sep}`;

  if (path !== webRoot && !path.startsWith(rootPrefix)) {
    throw new Error("Requested path escapes the bgcut web root.");
  }

  try {
    await access(path);

    return path;
  } catch {
    return resolve(webRoot, "index.html");
  }
};

const openBrowser = (url: string): void => {
  let command = { file: "xdg-open", args: [url] };

  if (process.platform === "darwin") {
    command = { file: "open", args: [url] };
  } else if (process.platform === "win32") {
    command = { file: "cmd", args: ["/c", "start", "", url] };
  }

  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
    });

    child.unref();
  } catch {
    // The URL is always printed, so browser launch is best-effort.
  }
};

export type LocalAppServer = {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly close: () => Promise<void>;
};

export type LocalAppServerOptions = {
  readonly port?: number;
  readonly webRoot?: string;
};

export const startLocalAppServer = async (
  options: LocalAppServerOptions = {},
): Promise<LocalAppServer> => {
  const webRoot = options.webRoot ?? packageWebRoot;

  await access(resolve(webRoot, "index.html"));

  const server = createServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";

      if (method !== "GET" && method !== "HEAD") {
        response.statusCode = 405;
        response.setHeader("allow", "GET, HEAD");
        response.end("Method not allowed.");

        return;
      }

      const url = new URL(request.url ?? "/", `http://${HOST}`);

      if (url.pathname === "/health") {
        const body = JSON.stringify({ ok: true, service: "bgcut-local" });

        response.statusCode = 200;
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("content-length", String(Buffer.byteLength(body)));

        if (method === "HEAD") {
          response.end();
        } else {
          response.end(body);
        }

        return;
      }

      if (url.pathname === `/models/${MODEL_FILENAME}`) {
        const modelPath = await Effect.runPromise(ensureCliModel());

        await sendFile(response, modelPath, {
          method,
          contentType: "application/octet-stream",
          cacheControl: IMMUTABLE_CACHE_CONTROL,
        });

        return;
      }

      const runtime = runtimeAssets.get(url.pathname);

      if (runtime !== undefined) {
        await sendFile(response, runtime.path, {
          method,
          contentType: runtime.contentType,
          cacheControl: IMMUTABLE_CACHE_CONTROL,
        });

        return;
      }

      const staticPath = await resolveStaticPath(url.pathname, webRoot);

      if (staticPath.endsWith("index.html") && url.pathname !== "/") {
        response.statusCode = 302;
        response.setHeader("cache-control", "no-store");
        response.setHeader("location", "/");
        response.end();

        return;
      }

      if (staticPath.endsWith("index.html")) {
        await sendLocalIndex(response, staticPath, method);

        return;
      }

      await sendFile(response, staticPath, {
        method,
        cacheControl: "public, max-age=31536000, immutable",
      });
    })().catch((cause: unknown) => {
      if (response.headersSent) {
        response.destroy(cause instanceof Error ? cause : undefined);

        return;
      }

      response.statusCode = 500;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(cause instanceof Error ? cause.message : "bgcut local server failed.");
    });
  });

  await new Promise<void>((resolveListening, rejectListening) => {
    const onError = (cause: Error) => {
      server.off("listening", onListening);
      rejectListening(cause);
    };

    const onListening = () => {
      server.off("error", onError);
      resolveListening();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port ?? 0, HOST);
  });

  const address = server.address();

  if (address === null) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));

    throw new Error("bgcut could not determine the local server port.");
  }

  // SAFETY: this server always binds to the TCP loopback host above, so Node returns AddressInfo here.
  const tcpAddress = address as AddressInfo;
  const port = tcpAddress.port;
  const url = `http://${HOST}:${port}/`;

  return {
    host: HOST,
    port,
    url,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((cause) => {
          if (cause !== undefined) {
            rejectClose(cause);
          } else {
            resolveClose();
          }
        });
      }),
  };
};

export const runLocalApp = async (options: ServeOptions): Promise<void> => {
  const server = await startLocalAppServer({ port: options.port });

  if (options.json) {
    console.log(JSON.stringify({
      url: server.url,
      host: server.host,
      port: server.port,
      pid: process.pid,
    }));
  } else {
    console.log(`bgcut is running locally at ${server.url}`);
    console.log("Press Ctrl+C to stop.");
  }

  if (options.open) {
    openBrowser(server.url);
  }

  await new Promise<void>((resolveShutdown) => {
    let stopping = false;

    const stop = () => {
      if (stopping) {
        return;
      }

      stopping = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);

      void server.close().finally(resolveShutdown);
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
};
