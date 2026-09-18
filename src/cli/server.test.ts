import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startLocalAppServer } from "./server";

test("local app server binds an available loopback port and serves the web UI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bgcut-local-app-"));
  const indexPath = join(directory, "index.html");

  await writeFile(indexPath, "<!doctype html><title>bgcut local</title>");

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
    expect(await page.text()).toContain("bgcut local");
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
