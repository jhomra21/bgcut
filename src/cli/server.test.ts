import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startLocalAppServer } from "./server";

test("local app server binds an available loopback port and serves the web UI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bgcut-local-app-"));
  const indexPath = join(directory, "index.html");

  await writeFile(indexPath, "<!doctype html><html><head><title>bgcut local</title></head><body></body></html>");

  const server = await startLocalAppServer({
    port: 0,
    webRoot: directory,
  });

  try {
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBeGreaterThan(0);

    const health = await fetch(new URL("/health", server.url));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      service: "bgcut-local",
    });

    const page = await fetch(server.url);
    expect(page.status).toBe(200);

    const pageHtml = await page.text();
    expect(pageHtml).toContain("bgcut local");
    expect(pageHtml).toContain('<meta name="bgcut-runtime" content="local" />');

    const fallbackPage = await fetch(new URL("/docs", server.url), {
      redirect: "manual",
    });

    expect(fallbackPage.status).toBe(302);
    expect(fallbackPage.headers.get("location")).toBe("/");
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
