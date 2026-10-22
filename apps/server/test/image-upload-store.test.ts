import { Readable } from "node:stream";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSER_IMAGE_TTL_MS,
  ImageUploadStore,
  MAX_COMPOSER_IMAGE_BYTES
} from "../src/image-upload-store.js";

const directories: string[] = [];

function pngBytes(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00
  ]);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ImageUploadStore", () => {
  it("persists a private signature-validated upload and reloads it", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "image-upload-store-"));
    directories.push(directory);
    const store = new ImageUploadStore(directory, () => 1_000);

    const created = await store.create(
      "session-a",
      "clipboard.png",
      "image/png",
      Readable.from([pngBytes()])
    );

    expect(created.filename).toBe("clipboard.png");
    expect(created.mediaType).toBe("image/png");
    expect(created.size).toBe(pngBytes().length);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(readFileSync(created.path).subarray(0, 8)).toEqual(pngBytes().subarray(0, 8));

    const reloaded = new ImageUploadStore(directory, () => 1_000);
    await expect(reloaded.resolveReady("session-a", [created.id])).resolves.toHaveLength(1);
  });

  it("rejects the wrong session, unsupported signatures, and oversized streams", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "image-upload-store-"));
    directories.push(directory);
    const store = new ImageUploadStore(directory, () => 1_000);

    await expect(
      store.create("session-a", "bad.txt", "image/png", Readable.from([Buffer.from("not an image")]))
    ).rejects.toThrow("Unsupported image type");
    await expect(
      store.create(
        "session-a",
        "huge.png",
        "image/png",
        Readable.from([Buffer.alloc(MAX_COMPOSER_IMAGE_BYTES + 1)])
      )
    ).rejects.toThrow("size limit");

    const created = await store.create(
      "session-a",
      "ok.png",
      "image/png",
      Readable.from([pngBytes()])
    );
    await expect(store.resolveReady("session-b", [created.id])).rejects.toThrow(
      "not available"
    );
  });

  it("consumes, removes, and expires uploads", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "image-upload-store-"));
    directories.push(directory);
    let now = 1_000;
    const store = new ImageUploadStore(directory, () => now);
    const created = await store.create(
      "session-a",
      "ok.png",
      "image/png",
      Readable.from([pngBytes()])
    );

    await store.consume("session-a", [created.id]);
    await expect(store.resolveReady("session-a", [created.id])).rejects.toThrow("not available");
    await store.remove("session-a", [created.id]);

    const expiring = await store.create(
      "session-a",
      "expiring.png",
      "image/png",
      Readable.from([pngBytes()])
    );
    now += 24 * 60 * 60 * 1000 + 1;
    await expect(store.cleanupExpired()).resolves.toBe(1);
    await expect(store.read("session-a", expiring.id)).rejects.toThrow("not available");
  });

  it("retains consumed images after the unsubmitted-upload expiry window", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "image-upload-store-"));
    directories.push(directory);
    let now = 1_000;
    const store = new ImageUploadStore(directory, () => now);
    const created = await store.create(
      "session-a",
      "task-history.png",
      "image/png",
      Readable.from([pngBytes()])
    );

    await store.consume("session-a", [created.id]);
    now += COMPOSER_IMAGE_TTL_MS + 1;

    await expect(store.cleanupExpired()).resolves.toBe(0);
    await expect(store.read("session-a", created.id)).resolves.toMatchObject({
      id: created.id,
      path: created.path
    });
    expect(readFileSync(created.path).subarray(0, 8)).toEqual(pngBytes().subarray(0, 8));
  });
});
