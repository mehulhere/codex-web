import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

export async function serveStaticWeb(
  root: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const absoluteRoot = path.resolve(root);
  const requestedFile = path.resolve(absoluteRoot, `.${pathname}`);
  if (pathname.includes("\0") || pathname.includes("\\") ||
      pathname.split("/").some((segment) => segment.startsWith(".")) ||
      (requestedFile !== absoluteRoot && !requestedFile.startsWith(`${absoluteRoot}${path.sep}`))) {
    res.writeHead(403);
    res.end();
    return;
  }

  const isNavigation = pathname === "/" || /^\/threads\/[^/]+(?:\/debug)?\/?$/.test(pathname);
  const filename = isNavigation ? path.join(absoluteRoot, "index.html") : requestedFile;
  const info = await stat(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  });
  if (!info?.isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const contentType = CONTENT_TYPES[path.extname(filename)] ?? "application/octet-stream";
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const acceptsGzip = (req.headers["accept-encoding"] ?? "").split(",").some((value) => {
    const [coding, ...parameters] = value.trim().split(";");
    if (coding?.trim() !== "gzip") return false;
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    return quality === undefined || Number(quality.trim().slice(2)) > 0;
  });
  const compress = req.method !== "HEAD" && acceptsGzip && info.size >= 1024 &&
    /text|javascript|json|xml/.test(contentType);
  const headers = {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
    Vary: "Accept-Encoding",
    "Cache-Control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable" : "no-cache"
  };
  if ((req.headers["if-none-match"] ?? "").split(",").some((value) =>
    value.trim() === etag || value.trim() === "*"
  )) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, {
    ...headers,
    ...(compress ? { "Content-Encoding": "gzip" } : { "Content-Length": info.size })
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  try {
    const source = createReadStream(filename);
    if (compress) await pipeline(source, createGzip(), res);
    else await pipeline(source, res);
  } catch (error) {
    if (!res.destroyed) throw error;
  }
}
