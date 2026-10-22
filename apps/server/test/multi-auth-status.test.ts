import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAccountForecast, readThreadAccountStatus } from "../src/multi-auth-status.js";

interface TestQuotaWindow {
  usedPercent?: number;
  windowMinutes?: number;
  resetAtMs?: number;
}

function writeStatus(
  codexHome: string,
  windows: { primary: TestQuotaWindow; secondary: TestQuotaWindow } = {
    primary: {
      usedPercent: 21,
      windowMinutes: 300,
      resetAtMs: 1_783_798_873_165
    },
    secondary: {
      usedPercent: 4,
      windowMinutes: 10_080,
      resetAtMs: 1_784_361_887_165
    }
  }
): void {
  const bindDir = join(codexHome, "multi-auth", "app-bind");
  mkdirSync(bindDir, { recursive: true });
  writeFileSync(
    join(bindDir, "runtime-rotation-app-bind-status.json"),
    JSON.stringify({
      version: 1,
      kind: "codex-app-runtime-rotation-router",
      state: "running",
      pid: 42,
      updatedAt: 1_783_781_233_423,
      baseUrl: "http://127.0.0.1:32899",
      totalRequests: 8,
      upstreamRequests: 9,
      retries: 1,
      rotations: 1,
      lastAccountIndex: 3,
      lastAccountLabel: "Account 4",
      lastAccountId: "org-redacted",
      lastAccountUpdatedAt: 1_783_781_228_006,
      threadStatuses: {
        "thread-4": {
          accountNumber: 4,
          accountDisplay: "Account 4 (de***@example.com)",
          maskedEmail: "de***@example.com",
          primary: windows.primary,
          secondary: windows.secondary,
          updatedAt: 1_783_781_435_801
        }
      },
      threadStatusPersistence: "durable",
      lastError: null
    }),
    "utf8"
  );
}

describe("readThreadAccountStatus", () => {
  it("accepts router WebSocket diagnostics without exposing them", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-mobile-status-"));
    writeStatus(codexHome);
    const statusPath = join(
      codexHome,
      "multi-auth",
      "app-bind",
      "runtime-rotation-app-bind-status.json"
    );
    const status = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
    Object.assign(status, {
      activeWebSockets: 3,
      webSocketUpgrades: 6,
      webSocketFallbacks: 0,
      webSocketAbnormalCloses: 0,
      webSocketPeakBufferedBytes: 1_728_310,
      webSocketLastError: null
    });
    writeFileSync(statusPath, JSON.stringify(status), "utf8");

    expect(readThreadAccountStatus("thread-4", { codexHome })).toMatchObject({
      state: "assigned",
      accountNumber: 4
    });
  });

  it("normalizes stale configured account counts to the reported quota accounts", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-mobile-status-"));
    writeStatus(codexHome);
    const statusPath = join(
      codexHome,
      "multi-auth",
      "app-bind",
      "runtime-rotation-app-bind-status.json"
    );
    const status = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, object>;
    status.poolQuota = {
      accountCount: 7,
      fiveHour: null,
      sevenDay: {
        windowMinutes: 10_080,
        reportedCount: 6,
        totalRemainingPercent: 574,
        averageRemainingPercent: 82,
        earliestResetAtMs: 1_784_487_760_959,
        latestResetAtMs: 1_784_582_025_955
      },
      updatedAt: 1_784_058_257_371
    };
    writeFileSync(statusPath, JSON.stringify(status), "utf8");

    expect(readThreadAccountStatus("thread-4", { codexHome }).poolQuota).toEqual({
      accountCount: 6,
      fiveHour: null,
      sevenDay: {
        windowMinutes: 10_080,
        reportedCount: 6,
        totalRemainingPercent: 574,
        averageRemainingPercent: 95.66666666666667,
        earliestResetAtMs: 1_784_487_760_959,
        latestResetAtMs: 1_784_582_025_955
      },
      updatedAt: 1_784_058_257_371
    });
  });

  it("returns only masked assignment and remaining quota for a routed task", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-mobile-status-"));
    writeStatus(codexHome);

    const result = readThreadAccountStatus("thread-4", {
      codexHome,
      now: 1_783_781_500_000
    });

    expect(result).toEqual({
      state: "assigned",
      accountNumber: 4,
      accountDisplay: "Account 4 (de***@example.com)",
      maskedEmail: "de***@example.com",
      quota5h: {
        remainingPercent: 79,
        resetAtMs: 1_783_798_873_165
      },
      quota7d: {
        remainingPercent: 96,
        resetAtMs: 1_784_361_887_165
      },
      poolQuota: null,
      updatedAt: 1_783_781_435_801,
      stale: false,
      reason: "Saved task assignment"
    });
  });

  it("reports a pending task without guessing an account", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-mobile-status-"));
    writeStatus(codexHome);

    expect(
      readThreadAccountStatus("new-thread", {
        codexHome,
        now: 1_783_781_500_000
      })
    ).toEqual({
      state: "pending",
      accountNumber: null,
      accountDisplay: null,
      maskedEmail: null,
      quota5h: null,
      quota7d: null,
      poolQuota: null,
      updatedAt: null,
      stale: false,
      reason: "Waiting for first routed response"
    });
  });

  it("maps a live seven-day window and ignores the zero-duration unavailable window", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-mobile-status-"));
    writeStatus(codexHome, {
      primary: {
        usedPercent: 4,
        windowMinutes: 10_080,
        resetAtMs: 1_784_487_760_959
      },
      secondary: {
        usedPercent: 0,
        windowMinutes: 0
      }
    });

    const result = readThreadAccountStatus("thread-4", {
      codexHome,
      now: 1_783_781_500_000
    });

    expect(result.quota5h).toBeNull();
    expect(result.quota7d).toEqual({
      remainingPercent: 96,
      resetAtMs: 1_784_487_760_959
    });
  });

  it("fails closed when router status is malformed", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-mobile-status-"));
    const bindDir = join(codexHome, "multi-auth", "app-bind");
    mkdirSync(bindDir, { recursive: true });
    writeFileSync(
      join(bindDir, "runtime-rotation-app-bind-status.json"),
      JSON.stringify({ threadStatuses: { "thread-4": { maskedEmail: "full@example.com" } } }),
      "utf8"
    );

    expect(() => readThreadAccountStatus("thread-4", { codexHome })).toThrowError();
  });
});

describe("parseAccountForecast", () => {
  it("returns safe status fields for every account", () => {
    const result = parseAccountForecast(JSON.stringify({
      command: "forecast",
      model: "gpt-5.5",
      liveProbe: false,
      runtimeOverlay: true,
      summary: { total: 2, ready: 1, delayed: 1, unavailable: 0, highRisk: 0 },
      recommendation: { recommendedIndex: 1, reason: "Lowest risk ready account." },
      probeErrors: [],
      accounts: [
        {
          index: 0,
          label: "Account 1 (hidden identity)",
          isCurrent: false,
          selected: false,
          primaryReason: "quota cache exhausted",
          availability: "delayed",
          riskScore: 60,
          riskLevel: "medium",
          waitMs: 120000,
          reasons: ["quota cache exhausted"]
        },
        {
          index: 1,
          label: "Account 2 (hidden identity)",
          isCurrent: true,
          selected: false,
          availability: "ready",
          riskScore: 0,
          riskLevel: "low",
          waitMs: 0,
          reasons: []
        }
      ]
    }));

    expect(result).toEqual({
      summary: { total: 2, ready: 1, delayed: 1, unavailable: 0 },
      recommendedAccountNumber: 2,
      accounts: [
        {
          accountNumber: 1,
          availability: "delayed",
          current: false,
          riskLevel: "medium",
          waitMs: 120000,
          reason: "quota cache exhausted"
        },
        {
          accountNumber: 2,
          availability: "ready",
          current: true,
          riskLevel: "low",
          waitMs: 0,
          reason: null
        }
      ]
    });
  });
});
