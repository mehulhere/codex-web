import { open, stat } from "node:fs/promises";
import type { ThreadConversationState } from "@farfield/protocol";
import { z } from "zod";

export const MAX_THREAD_IMAGE_BYTES = 20 * 1024 * 1024;

const ImageIndexSchema = z.number().int().nonnegative();
const HttpsImageUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "Image URL must use HTTPS");

const DataPngSchema = createDataImageSchema("image/png");
const DataJpegSchema = createDataImageSchema("image/jpeg");
const DataWebpSchema = createDataImageSchema("image/webp");
const DataGifSchema = createDataImageSchema("image/gif");
const DataAvifSchema = createDataImageSchema("image/avif");
const DataImageSchema = z.union([
  DataPngSchema,
  DataJpegSchema,
  DataWebpSchema,
  DataGifSchema,
  DataAvifSchema
]);
const MarkdownImagePattern =
  /!\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+[^)\n]*)?\s*\)/gu;

export type ImageContentType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/avif";

type TurnItem = ThreadConversationState["turns"][number]["items"][number];

export type ThreadImageReference =
  | { type: "local"; path: string }
  | { type: "remote"; url: string }
  | { type: "data"; value: string };

export type MaterializedThreadImage =
  | { type: "bytes"; contentType: ImageContentType; body: Buffer }
  | { type: "redirect"; location: string };

export class ThreadMediaNotFoundError extends Error {
  public constructor() {
    super("Referenced image was not found.");
    this.name = "ThreadMediaNotFoundError";
  }
}

function createDataImageSchema(contentType: ImageContentType) {
  const prefix = `data:${contentType};base64,`;
  return z
    .string()
    .regex(new RegExp(`^${prefix}[A-Za-z0-9+/]*={0,2}$`))
    .transform((value) => ({
      contentType,
      encoded: value.slice(prefix.length)
    }));
}

function parseExternalImageReference(value: string): ThreadImageReference {
  if (DataImageSchema.safeParse(value).success) {
    return { type: "data", value };
  }
  return { type: "remote", url: HttpsImageUrlSchema.parse(value) };
}

function optionalExternalImageReference(value: string): ThreadImageReference | null {
  if (DataImageSchema.safeParse(value).success) {
    return { type: "data", value };
  }
  const remote = HttpsImageUrlSchema.safeParse(value);
  return remote.success ? { type: "remote", url: remote.data } : null;
}

function markdownImageSources(text: string): string[] {
  return Array.from(text.matchAll(MarkdownImagePattern), (match) =>
    (match[1] ?? match[2] ?? "").trim()
  ).filter((value) => value.length > 0);
}

function markdownImageReference(value: string): ThreadImageReference {
  const external = optionalExternalImageReference(value);
  if (external) {
    return external;
  }
  if (value.startsWith("file://")) {
    try {
      const url = new URL(value);
      if (url.protocol === "file:" && (!url.hostname || url.hostname === "localhost")) {
        return { type: "local", path: decodeURIComponent(url.pathname) };
      }
    } catch {
      // The media materializer will reject malformed local paths safely.
    }
  }
  return { type: "local", path: value };
}

function itemImageReferences(item: TurnItem): ThreadImageReference[] {
  switch (item.type) {
    case "userMessage":
    case "steeringUserMessage":
      return item.content.flatMap((part) => {
        if (part.type === "localImage") {
          return [{ type: "local" as const, path: part.path }];
        }
        if (part.type === "image") {
          return [parseExternalImageReference(part.url)];
        }
        return [];
      });
    case "imageView":
      return [{ type: "local", path: item.path }];
    case "imageGeneration": {
      if (item.savedPath) {
        return [{ type: "local", path: item.savedPath }];
      }
      const result = item.result === undefined ? null : optionalExternalImageReference(item.result);
      return result ? [result] : [];
    }
    case "dynamicToolCall":
      return (item.contentItems ?? []).flatMap((content) =>
        content.type === "inputImage"
          ? [parseExternalImageReference(content.imageUrl)]
          : []
      );
    case "agentMessage":
      return markdownImageSources(item.text).map(markdownImageReference);
    default:
      return [];
  }
}

export function resolveThreadImage(
  thread: ThreadConversationState,
  itemId: string,
  imageIndex: number
): ThreadImageReference {
  const parsedIndex = ImageIndexSchema.parse(imageIndex);
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.id !== itemId) {
        continue;
      }
      const reference = itemImageReferences(item)[parsedIndex];
      if (!reference) {
        throw new ThreadMediaNotFoundError();
      }
      return reference;
    }
  }
  throw new ThreadMediaNotFoundError();
}

export async function resolveCurrentThreadImage(
  liveState: ThreadConversationState | null,
  readStoredState: () => Promise<ThreadConversationState>,
  itemId: string,
  imageIndex: number
): Promise<ThreadImageReference> {
  const state = liveState ?? await readStoredState();
  return resolveThreadImage(state, itemId, imageIndex);
}

export function detectImageContentType(body: Buffer): ImageContentType | null {
  if (
    body.length >= 8 &&
    body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    body.length >= 6 &&
    (body.subarray(0, 6).equals(Buffer.from("GIF87a")) ||
      body.subarray(0, 6).equals(Buffer.from("GIF89a")))
  ) {
    return "image/gif";
  }
  if (
    body.length >= 12 &&
    body.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    body.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return "image/webp";
  }
  if (
    body.length >= 12 &&
    body.subarray(4, 8).equals(Buffer.from("ftyp")) &&
    (body.subarray(8, 12).equals(Buffer.from("avif")) ||
      body.subarray(8, 12).equals(Buffer.from("avis")))
  ) {
    return "image/avif";
  }
  return null;
}

function assertImageSize(body: Buffer): void {
  if (body.length > MAX_THREAD_IMAGE_BYTES) {
    throw new Error("Referenced image exceeds the size limit.");
  }
}

async function readLimitedLocalImage(filePath: string): Promise<Buffer> {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    throw new ThreadMediaNotFoundError();
  }
  if (!fileStats.isFile()) {
    throw new ThreadMediaNotFoundError();
  }
  if (fileStats.size > MAX_THREAD_IMAGE_BYTES) {
    throw new Error("Referenced image exceeds the size limit.");
  }

  let fileHandle;
  try {
    fileHandle = await open(filePath, "r");
  } catch {
    throw new ThreadMediaNotFoundError();
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (totalBytes <= MAX_THREAD_IMAGE_BYTES) {
      const remainingBytes = MAX_THREAD_IMAGE_BYTES + 1 - totalBytes;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remainingBytes));
      const { bytesRead } = await fileHandle.read(chunk, 0, chunk.length, totalBytes);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
  } catch {
    throw new ThreadMediaNotFoundError();
  } finally {
    await fileHandle.close().catch(() => undefined);
  }

  if (totalBytes > MAX_THREAD_IMAGE_BYTES) {
    throw new Error("Referenced image exceeds the size limit.");
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function materializeThreadImage(
  reference: ThreadImageReference
): Promise<MaterializedThreadImage> {
  if (reference.type === "remote") {
    return {
      type: "redirect",
      location: HttpsImageUrlSchema.parse(reference.url)
    };
  }

  let body: Buffer;
  let declaredContentType: ImageContentType | null = null;
  if (reference.type === "data") {
    const parsed = DataImageSchema.parse(reference.value);
    declaredContentType = parsed.contentType;
    body = Buffer.from(parsed.encoded, "base64");
  } else {
    body = await readLimitedLocalImage(reference.path);
  }

  assertImageSize(body);
  const detectedContentType = detectImageContentType(body);
  if (!detectedContentType || (declaredContentType && detectedContentType !== declaredContentType)) {
    throw new Error("Unsupported image type.");
  }
  return {
    type: "bytes",
    contentType: detectedContentType,
    body
  };
}
