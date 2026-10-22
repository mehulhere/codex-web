import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { detectImageContentType, type ImageContentType } from "./thread-media.js";

export const MAX_COMPOSER_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_COMPOSER_IMAGE_COUNT = 8;
export const COMPOSER_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

const ImageContentTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif"
]);

const StoredImageRecordSchema = z
  .object({
    id: z.string().uuid(),
    sessionKey: z.string().min(1),
    filename: z.string().min(1).max(180),
    mediaType: ImageContentTypeSchema,
    size: z.number().int().positive().max(MAX_COMPOSER_IMAGE_BYTES),
    createdAtMs: z.number().int().nonnegative(),
    state: z.enum(["ready", "consumed"])
  })
  .strict();

type StoredImageRecord = z.infer<typeof StoredImageRecordSchema>;

export interface ImageUploadMetadata {
  id: string;
  filename: string;
  mediaType: ImageContentType;
  size: number;
  createdAtMs: number;
  path: string;
}

function resolveDefaultDirectory(): string {
  const stateHome = process.env["XDG_STATE_HOME"]?.trim();
  const baseDirectory = stateHome || path.join(os.homedir(), ".local", "state");
  return path.join(baseDirectory, "codex-mobile", "images");
}

function sanitizeFilename(value: string): string {
  const basename = path.basename(value).trim().replace(/[\u0000-\u001f]/gu, "");
  return basename.slice(0, 180) || "pasted-image";
}

function metadataPath(directory: string, id: string): string {
  return path.join(directory, `${id}.json`);
}

function imagePath(directory: string, id: string): string {
  return path.join(directory, `${id}.bin`);
}

function isExpired(record: StoredImageRecord, nowMs: number): boolean {
  return record.state === "ready" && nowMs - record.createdAtMs >= COMPOSER_IMAGE_TTL_MS;
}

export class ImageUploadStore {
  public constructor(
    private readonly directory = resolveDefaultDirectory(),
    private readonly now = () => Date.now()
  ) {}

  public async create(
    sessionKey: string,
    filename: string,
    declaredMediaType: string,
    stream: AsyncIterable<Buffer | string>
  ): Promise<ImageUploadMetadata> {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) throw new Error("Image upload session is required");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_COMPOSER_IMAGE_BYTES) {
        throw new Error("Image upload exceeds the size limit.");
      }
      chunks.push(buffer);
    }
    const body = Buffer.concat(chunks, totalBytes);
    const detectedMediaType = detectImageContentType(body);
    if (!detectedMediaType || detectedMediaType !== declaredMediaType) {
      throw new Error("Unsupported image type.");
    }

    const id = randomUUID();
    const record: StoredImageRecord = {
      id,
      sessionKey: normalizedSessionKey,
      filename: sanitizeFilename(filename),
      mediaType: detectedMediaType,
      size: body.length,
      createdAtMs: this.now(),
      state: "ready"
    };
    const temporaryImagePath = path.join(this.directory, `${id}.tmp`);
    try {
      await writeFile(temporaryImagePath, body, { mode: 0o600 });
      await chmod(temporaryImagePath, 0o600);
      await rename(temporaryImagePath, imagePath(this.directory, id));
      await this.saveRecord(record);
    } catch (error) {
      await rm(temporaryImagePath, { force: true });
      await rm(imagePath(this.directory, id), { force: true });
      throw error;
    }
    return this.toMetadata(record);
  }

  public async resolveReady(
    sessionKey: string,
    ids: readonly string[]
  ): Promise<ImageUploadMetadata[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length || uniqueIds.length > MAX_COMPOSER_IMAGE_COUNT) {
      throw new Error("Too many or duplicate image uploads.");
    }
    const records = await Promise.all(uniqueIds.map((id) => this.loadAuthorized(sessionKey, id)));
    if (records.some((record) => record.state !== "ready")) {
      throw new Error("Image upload is not available.");
    }
    return records.map((record) => this.toMetadata(record));
  }

  public async read(sessionKey: string, id: string): Promise<ImageUploadMetadata> {
    return this.toMetadata(await this.loadAuthorized(sessionKey, id));
  }

  public async consume(sessionKey: string, ids: readonly string[]): Promise<void> {
    const records = await Promise.all(ids.map((id) => this.loadAuthorized(sessionKey, id)));
    for (const record of records) {
      if (record.state !== "ready") throw new Error("Image upload is not available.");
      await this.saveRecord({ ...record, state: "consumed" });
    }
  }

  public async consumeInternal(ids: readonly string[]): Promise<void> {
    const records = await Promise.all(ids.map((id) => this.loadRecord(id)));
    for (const record of records) {
      if (record.state === "ready") {
        await this.saveRecord({ ...record, state: "consumed" });
      }
    }
  }

  public async remove(sessionKey: string, ids: readonly string[]): Promise<void> {
    const records = await Promise.all(ids.map((id) => this.loadAuthorized(sessionKey, id)));
    await Promise.all(records.flatMap((record) => [
      rm(metadataPath(this.directory, record.id), { force: true }),
      rm(imagePath(this.directory, record.id), { force: true })
    ]));
  }

  public async cleanupExpired(): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const entry of entries.filter((value) => value.endsWith(".json"))) {
      const id = entry.slice(0, -5);
      try {
        const record = await this.loadRecord(id);
        if (!isExpired(record, this.now())) continue;
        await rm(metadataPath(this.directory, id), { force: true });
        await rm(imagePath(this.directory, id), { force: true });
        removed += 1;
      } catch {
        // A malformed or partial upload is safe to ignore until the next pass.
      }
    }
    return removed;
  }

  private async loadAuthorized(sessionKey: string, id: string): Promise<StoredImageRecord> {
    const record = await this.loadRecord(id);
    if (record.sessionKey !== sessionKey.trim() || isExpired(record, this.now())) {
      throw new Error("Image upload is not available.");
    }
    return record;
  }

  private async loadRecord(id: string): Promise<StoredImageRecord> {
    if (!z.string().uuid().safeParse(id).success) {
      throw new Error("Image upload is not available.");
    }
    try {
      return StoredImageRecordSchema.parse(
        JSON.parse(await readFile(metadataPath(this.directory, id), "utf8"))
      );
    } catch {
      throw new Error("Image upload is not available.");
    }
  }

  private async saveRecord(record: StoredImageRecord): Promise<void> {
    await writeFile(metadataPath(this.directory, record.id), JSON.stringify(record), {
      mode: 0o600,
      encoding: "utf8"
    });
    await chmod(metadataPath(this.directory, record.id), 0o600);
  }

  private toMetadata(record: StoredImageRecord): ImageUploadMetadata {
    return {
      id: record.id,
      filename: record.filename,
      mediaType: record.mediaType,
      size: record.size,
      createdAtMs: record.createdAtMs,
      path: imagePath(this.directory, record.id)
    };
  }
}
