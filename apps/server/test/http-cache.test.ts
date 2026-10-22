import { describe, expect, it } from "vitest";
import { createConditionalJsonResponse } from "../src/http-cache.js";

describe("conditional JSON responses", () => {
  it("returns a private cache validator with the complete JSON response", () => {
    const response = createConditionalJsonResponse({ ok: true, data: ["thread-1"] });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "Cache-Control": "private, no-cache",
      "Content-Type": "application/json; charset=utf-8"
    });
    expect(response.headers.ETag).toMatch(/^"[a-f0-9]{64}"$/u);
    expect(response.body?.toString("utf8")).toBe('{"ok":true,"data":["thread-1"]}');
  });

  it("returns no body when the client already has the same response", () => {
    const initial = createConditionalJsonResponse({ ok: true, value: 1 });
    const unchanged = createConditionalJsonResponse(
      { ok: true, value: 1 },
      initial.headers.ETag
    );

    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBeNull();
    expect(unchanged.headers.ETag).toBe(initial.headers.ETag);
  });

  it("returns changed content when any response field changes", () => {
    const initial = createConditionalJsonResponse({ ok: true, value: 1 });
    const changed = createConditionalJsonResponse(
      { ok: true, value: 2 },
      initial.headers.ETag
    );

    expect(changed.statusCode).toBe(200);
    expect(changed.headers.ETag).not.toBe(initial.headers.ETag);
    expect(changed.body?.toString("utf8")).toContain('"value":2');
  });
});
