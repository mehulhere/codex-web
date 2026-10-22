import { describe, expect, it } from "vitest";
import {
  getCoreRefreshIntervalMs,
  getThreadListRefreshIntervalMs,
  getThreadRefreshIntervalMs,
  getThreadRefreshMode
} from "../src/thread-refresh.js";

describe("thread refresh policy", () => {
  it("loads durable history for selection, manual refresh, and settled generation", () => {
    expect(getThreadRefreshMode("selection")).toBe("durable-and-live");
    expect(getThreadRefreshMode("manual")).toBe("durable-and-live");
    expect(getThreadRefreshMode("generation-settled")).toBe("durable-only");
  });

  it("uses SSE notifications without an additional connected polling loop", () => {
    expect(getThreadRefreshMode("sse", true)).toBe("live-only");
    expect(getThreadRefreshMode("connected-timer", true)).toBe("none");
    expect(getThreadRefreshMode("disconnected-timer", true)).toBe("live-only");
  });

  it("keeps idle selected-task polling lightweight", () => {
    expect(getThreadRefreshMode("sse", false)).toBe("live-only");
    expect(getThreadRefreshMode("connected-timer", false)).toBe("none");
    expect(getThreadRefreshMode("disconnected-timer", false)).toBe("live-only");
  });

  it("backs off selected-task polling while the live connection is unavailable", () => {
    expect(getThreadRefreshIntervalMs("connected-timer")).toBeNull();
    expect(getThreadRefreshIntervalMs("disconnected-timer")).toBe(5_000);
  });

  it("uses a relaxed core status check because live task updates use SSE", () => {
    expect(getCoreRefreshIntervalMs()).toBe(15_000);
  });

  it("checks the task list every five seconds", () => {
    expect(getThreadListRefreshIntervalMs()).toBe(5_000);
  });
});
