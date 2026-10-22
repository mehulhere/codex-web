import { createHash } from "node:crypto";

export interface ConditionalJsonResponse {
  statusCode: 200 | 304;
  body: Buffer | null;
  headers: Record<string, string | number> & { ETag: string };
}

function matchesEtag(ifNoneMatch: string | string[] | undefined, etag: string): boolean {
  const values = Array.isArray(ifNoneMatch) ? ifNoneMatch : [ifNoneMatch];
  return values.some((value) =>
    value
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === "*" || candidate === etag || candidate === `W/${etag}`)
  );
}

export function createConditionalJsonResponse(
  value: unknown,
  ifNoneMatch?: string | string[]
): ConditionalJsonResponse {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  const commonHeaders = {
    "Cache-Control": "private, no-cache",
    ETag: etag
  } as const;

  if (matchesEtag(ifNoneMatch, etag)) {
    return {
      statusCode: 304,
      body: null,
      headers: commonHeaders
    };
  }

  return {
    statusCode: 200,
    body,
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length
    }
  };
}
