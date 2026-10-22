import { afterEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "../src/lib/client-error-logger";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("frontend error logger", () => {
  it("reports a sanitized error without leaking bearer credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    reportClientError(
      new Error("Bearer secret-token failed"),
      "request-error",
      { threadId: "thread-1" }
    );
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/client-errors",
      expect.objectContaining({ method: "POST", keepalive: true })
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      message: string;
      details: { threadId?: string };
    };
    expect(body.message).toContain("Bearer [redacted]");
    expect(body.message).not.toContain("secret-token");
    expect(body.details.threadId).toBe("thread-1");
  });

  it("does not repeatedly post an identical request error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const error = new Error("HTTP 502 duplicate-gateway-test");
    reportClientError(error, "request-error", { threadId: "thread-duplicate" });
    reportClientError(error, "request-error", { threadId: "thread-duplicate" });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
