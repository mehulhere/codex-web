import { type IncomingMessage } from "node:http";
import { chmodSync, createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { JsonValueSchema } from "@farfield/protocol";
import { z } from "zod";

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export const API_SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff"
} as const;

export const TRACE_SECURITY_HEADERS = {
  ...API_SECURITY_HEADERS
} as const;

type JsonRequestBody = z.infer<typeof JsonValueSchema>;

export class HttpRequestError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpRequestError";
    this.statusCode = statusCode;
  }
}

export function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === "/api/auth/session" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout"
  );
}

export function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

export function createPrivateAppendStream(filePath: string): WriteStream {
  const stream = createWriteStream(filePath, {
    flags: "a",
    mode: 0o600
  });
  stream.on("open", () => {
    chmodSync(filePath, 0o600);
  });
  return stream;
}

export async function readLimitedJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES
): Promise<JsonRequestBody> {
  req.setEncoding("utf8");
  const chunks: string[] = [];
  let byteLength = 0;

  for await (const chunk of req) {
    const text = String(chunk);
    byteLength += Buffer.byteLength(text, "utf8");
    if (byteLength > maxBytes) {
      req.resume();
      throw new HttpRequestError(
        413,
        `Request body exceeds ${String(maxBytes)} bytes`
      );
    }
    chunks.push(text);
  }

  const raw = chunks.join("").trim();
  if (!raw) {
    return JsonValueSchema.parse({});
  }

  try {
    return JsonValueSchema.parse(JSON.parse(raw));
  } catch {
    throw new HttpRequestError(400, "Request body must contain valid JSON");
  }
}

export function parseBoundedInteger(
  value: string | null,
  defaultValue: number,
  maximum: number,
  parameterName: string
): number {
  if (value === null || value.length === 0) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new HttpRequestError(
      400,
      `${parameterName} must be a positive integer no greater than ${String(maximum)}`
    );
  }
  return parsed;
}
