import { describe, expect, it } from "vitest";
import { appendTranscript, DICTATION_CHUNK_INTERVAL_MS } from "../src/hooks/useDictation";
import { formatAccountCommandStatus, formatReset } from "../src/components/AccountQuotaStrip";

describe("mobile dictation", () => {
  it("uploads microphone audio every ten seconds", () => {
    expect(DICTATION_CHUNK_INTERVAL_MS).toBe(10_000);
  });

  it("appends ordered transcript segments without damaging the draft", () => {
    expect(appendTranscript("Commit this.", " Then push it. ")).toBe("Commit this. Then push it.");
    expect(appendTranscript("", "Hello")).toBe("Hello");
  });

  it("formats /status with account identity, quotas, resets, and routing reason", () => {
    expect(formatAccountCommandStatus({
      state: "assigned",
      accountNumber: 4,
      accountDisplay: "Account 4",
      maskedEmail: "de***@example.com",
      quota5h: { remainingPercent: 99, resetAtMs: 3_600_000 },
      quota7d: { remainingPercent: 100, resetAtMs: 7_200_000 },
      poolQuota: null,
      updatedAt: 1,
      stale: false,
      reason: "Best available account"
    }, 0)).toContain("Account 4 (de***@example.com) · 5h 99% · resets in 1h · 7d 100% · resets in 2h · Best available account");
  });

  it("does not describe an expired quota reset as zero minutes away", () => {
    expect(formatReset(1_000, 2_000)).toBe("reset due");
  });
});
