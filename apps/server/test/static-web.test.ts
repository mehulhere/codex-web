import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { serveStaticWeb } from "../src/static-web.js";

describe("production PWA server", () => {
  let scratch: string;
  let root: string;
  let origin: string;
  const server = http.createServer((req, res) => {
    void serveStaticWeb(root, req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "codex-mobile-static-"));
    root = path.join(scratch, "dist");
    await mkdir(path.join(root, "assets"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "index.html"), "<html>PWA shell</html>"),
      writeFile(path.join(root, "assets", "app-hash.js"), "console.log('app');"),
      writeFile(path.join(root, "assets", "large-hash.js"), "x".repeat(10_000)),
      writeFile(path.join(root, "service-worker.js"), "// worker"),
      writeFile(path.join(root, "manifest.webmanifest"), '{"name":"Codex Mobile"}'),
      writeFile(path.join(scratch, "secret.txt"), "not a web asset")
    ]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = z.object({ address: z.string(), family: z.string(), port: z.number() })
      .strict().parse(server.address());
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(scratch, { recursive: true });
  });

  it.each(["/", "/threads/thread-1", "/threads/thread-1/debug"])(
    "serves the shell on %s without caching stale HTML", async (route) => {
      const response = await fetch(origin + route);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(await response.text()).toBe("<html>PWA shell</html>");
    }
  );

  it("streams assets with the correct MIME type and supports HEAD", async () => {
    const response = await fetch(origin + "/assets/app-hash.js");
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toBe("console.log('app');");
    const head = await fetch(origin + "/assets/app-hash.js", { method: "HEAD" });
    expect(head.headers.get("content-length")).toBe("19");
    expect(await head.text()).toBe("");
    const worker = await fetch(origin + "/service-worker.js");
    expect(worker.headers.get("cache-control")).toBe("no-cache");
    const manifest = await fetch(origin + "/manifest.webmanifest");
    expect(manifest.headers.get("content-type")).toBe("application/manifest+json");
  });

  it("rejects traversal, malformed paths, missing files and writes", async () => {
    for (const route of ["/..%2Fsecret.txt", "/..%5Csecret.txt", "/%00", "/.env"]) {
      expect((await fetch(origin + route)).status).toBe(403);
    }
    expect((await fetch(origin + "/%ZZ")).status).toBe(400);
    expect((await fetch(origin + "/assets/missing.js")).status).toBe(404);
    expect((await fetch(origin + "/", { method: "POST" })).status).toBe(405);
  });

  it("preserves compressed transfers and conditional asset requests", async () => {
    const response = await fetch(origin + "/assets/large-hash.js", {
      headers: { "Accept-Encoding": "gzip" }
    });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(await response.text()).toBe("x".repeat(10_000));
    const cached = await fetch(origin + "/assets/large-hash.js", {
      headers: { "If-None-Match": response.headers.get("etag") ?? "" }
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    const plain = await fetch(origin + "/assets/large-hash.js", {
      headers: { "Accept-Encoding": "gzip;q=0, identity" }
    });
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(plain.headers.get("content-length")).toBe("10000");
  });
});
