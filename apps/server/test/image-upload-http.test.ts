import { Readable } from "node:stream";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImageUploadStore } from "../src/image-upload-store.js";
import { parseMultipartImageUpload } from "../src/image-upload-http.js";

const directories: string[] = [];

function pngBytes(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00
  ]);
}

function multipartBody(fieldName = "image"): {
  headers: { "content-type": string };
  stream: Readable;
} {
  const boundary = "codex-mobile-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="paste.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    pngBytes(),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    stream: Readable.from([body])
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("parseMultipartImageUpload", () => {
  it("stores one image field for the authenticated session", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "image-upload-http-"));
    directories.push(directory);
    const store = new ImageUploadStore(directory);
    const request = multipartBody();

    const image = await parseMultipartImageUpload(
      request.headers,
      request.stream,
      store,
      "session-a"
    );

    expect(image.filename).toBe("paste.png");
    expect(image.mediaType).toBe("image/png");
    await expect(store.resolveReady("session-a", [image.id])).resolves.toHaveLength(1);
  });

  it("rejects multipart files outside the image field", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "image-upload-http-"));
    directories.push(directory);
    const store = new ImageUploadStore(directory);
    const request = multipartBody("file");

    await expect(
      parseMultipartImageUpload(request.headers, request.stream, store, "session-a")
    ).rejects.toThrow("image field");
  });
});
