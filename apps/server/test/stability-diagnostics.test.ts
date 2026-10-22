import { describe, expect, it, vi } from "vitest";
import { ThreadStreamStabilityDiagnostics } from "../src/stability-diagnostics.js";

describe("ThreadStreamStabilityDiagnostics", () => {
  it("stays quiet for a healthy low-rate window", () => {
    let now = 0;
    const onWarning = vi.fn();
    const diagnostics = new ThreadStreamStabilityDiagnostics({
      windowMs: 1_000,
      warningThreshold: 4,
      now: () => now,
      onWarning
    });

    diagnostics.recordEvent("thread-1");
    diagnostics.recordEvent("thread-1");
    now = 1_000;
    diagnostics.recordEvent("thread-2");

    expect(onWarning).not.toHaveBeenCalled();
  });

  it("reports one aggregate warning for a high-rate window", () => {
    let now = 0;
    const onWarning = vi.fn();
    const diagnostics = new ThreadStreamStabilityDiagnostics({
      windowMs: 1_000,
      warningThreshold: 3,
      now: () => now,
      onWarning
    });

    diagnostics.recordEvent("thread-1");
    diagnostics.recordEvent("thread-1");
    diagnostics.recordEvent("thread-2");
    now = 1_000;
    diagnostics.recordEvent("thread-3");

    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning).toHaveBeenCalledWith({
      windowMs: 1_000,
      eventCount: 3,
      invalidEventCount: 0,
      reductionFailureCount: 0,
      threadCount: 2
    });
  });

  it("reports malformed events and reduction failures below the rate threshold", () => {
    let now = 0;
    const onWarning = vi.fn();
    const diagnostics = new ThreadStreamStabilityDiagnostics({
      windowMs: 1_000,
      warningThreshold: 100,
      now: () => now,
      onWarning
    });

    diagnostics.recordInvalidEvent("thread-1");
    diagnostics.recordEvent("thread-2");
    diagnostics.recordReductionFailure("thread-2");
    now = 1_000;
    diagnostics.recordEvent("thread-3");

    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning).toHaveBeenCalledWith({
      windowMs: 1_000,
      eventCount: 2,
      invalidEventCount: 1,
      reductionFailureCount: 1,
      threadCount: 2
    });
  });

  it("allows only one detailed log per failure type in each window", () => {
    let now = 0;
    const diagnostics = new ThreadStreamStabilityDiagnostics({
      windowMs: 1_000,
      warningThreshold: 100,
      now: () => now,
      onWarning: vi.fn()
    });

    expect(diagnostics.recordInvalidEvent("thread-1")).toBe(true);
    expect(diagnostics.recordInvalidEvent("thread-1")).toBe(false);
    expect(diagnostics.recordReductionFailure("thread-1")).toBe(true);
    expect(diagnostics.recordReductionFailure("thread-1")).toBe(false);

    now = 1_000;
    expect(diagnostics.recordInvalidEvent("thread-1")).toBe(true);
    expect(diagnostics.recordReductionFailure("thread-1")).toBe(true);
  });
});
