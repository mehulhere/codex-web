import busboy from "busboy";
import type { IncomingHttpHeaders } from "node:http";
import type { Readable } from "node:stream";
import {
  ImageUploadStore,
  MAX_COMPOSER_IMAGE_BYTES,
  type ImageUploadMetadata
} from "./image-upload-store.js";

export async function parseMultipartImageUpload(
  headers: IncomingHttpHeaders,
  body: Readable,
  store: ImageUploadStore,
  sessionKey: string
): Promise<ImageUploadMetadata> {
  return new Promise<ImageUploadMetadata>((resolve, reject) => {
    let settled = false;
    let sawImage = false;
    let upload: Promise<ImageUploadMetadata> | null = null;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      body.resume();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    let parser;
    try {
      parser = busboy({
        headers,
        limits: {
          files: 1,
          fields: 0,
          parts: 1,
          fileSize: MAX_COMPOSER_IMAGE_BYTES
        }
      });
    } catch (error) {
      fail(error);
      return;
    }

    parser.on("file", (fieldName, file, info) => {
      if (fieldName !== "image") {
        file.resume();
        fail(new Error("Multipart upload must contain an image field."));
        return;
      }
      if (sawImage) {
        file.resume();
        fail(new Error("Only one image may be uploaded per request."));
        return;
      }
      sawImage = true;
      upload = store.create(sessionKey, info.filename, info.mimeType, file);
      file.once("limit", () => fail(new Error("Image upload exceeds the size limit.")));
      upload.catch(fail);
    });
    parser.on("field", () => fail(new Error("Multipart upload must contain an image field.")));
    parser.on("error", fail);
    parser.on("finish", async () => {
      if (settled) return;
      if (!sawImage || !upload) {
        fail(new Error("Multipart upload must contain an image field."));
        return;
      }
      try {
        const image = await upload;
        if (!settled) {
          settled = true;
          resolve(image);
        }
      } catch (error) {
        fail(error);
      }
    });
    body.once("error", fail);
    body.pipe(parser);
  });
}
