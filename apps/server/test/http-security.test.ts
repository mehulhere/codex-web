import { IncomingMessage } from "node:http";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_SECURITY_HEADERS,
  createPrivateAppendStream,
  ensurePrivateDirectory,
  HttpRequestError,
  MAX_JSON_BODY_BYTES,
  TRACE_SECURITY_HEADERS,
  isPublicApiPath,
  parseBoundedInteger,
  readLimitedJsonBody
} from "../src/http-security.js";

function requestWithBody(body: string): IncomingMessage {
  const request = new IncomingMessage(new net.Socket());
  request.push(body);
  request.push(null);
  return request;
}

describe("HTTP security helpers", () => {
  it("accepts a JSON body at the byte limit", async () => {
    const body = JSON.stringify("a".repeat(MAX_JSON_BODY_BYTES - 2));
    await expect(readLimitedJsonBody(requestWithBody(body))).resolves.toBe(
      "a".repeat(MAX_JSON_BODY_BYTES - 2)
    );
  });

  it("rejects a JSON body over the byte limit with 413", async () => {
    const body = JSON.stringify("a".repeat(MAX_JSON_BODY_BYTES - 1));
    const request = requestWithBody(body);

    await expect(readLimitedJsonBody(request)).rejects.toMatchObject({
      statusCode: 413,
      message: "Request body exceeds 1048576 bytes"
    });
  });

  it("rejects invalid JSON with 400", async () => {
    await expect(readLimitedJsonBody(requestWithBody("{"))).rejects.toMatchObject({
      statusCode: 400,
      message: "Request body must contain valid JSON"
    });
  });

  it("accepts bounded positive integer query values", () => {
    expect(parseBoundedInteger(null, 80, 200, "limit")).toBe(80);
    expect(parseBoundedInteger("200", 80, 200, "limit")).toBe(200);
  });

  it("rejects invalid and over-maximum query values", () => {
    expect(() => parseBoundedInteger("0", 80, 200, "limit")).toThrow(HttpRequestError);
    expect(() => parseBoundedInteger("201", 80, 200, "limit")).toThrowError(
      "limit must be a positive integer no greater than 200"
    );
  });

  it("exports non-cacheable API and trace headers", () => {
    expect(API_SECURITY_HEADERS).toMatchObject({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    expect(TRACE_SECURITY_HEADERS).toMatchObject(API_SECURITY_HEADERS);
  });

  it("keeps diagnostics behind authentication", () => {
    expect(isPublicApiPath("/api/auth/session")).toBe(true);
    expect(isPublicApiPath("/api/auth/login")).toBe(true);
    expect(isPublicApiPath("/api/auth/logout")).toBe(true);
    expect(isPublicApiPath("/api/health")).toBe(false);
    expect(isPublicApiPath("/api/remote/status")).toBe(false);
  });

  it("creates private trace directories and files", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "farfield-trace-"));
    const directory = path.join(root, "traces");
    const tracePath = path.join(directory, "trace.ndjson");

    try {
      ensurePrivateDirectory(directory);
      const stream = createPrivateAppendStream(tracePath);
      stream.end("{}\n");
      await new Promise<void>((resolve, reject) => {
        stream.on("close", resolve);
        stream.on("error", reject);
      });

      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(tracePath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
