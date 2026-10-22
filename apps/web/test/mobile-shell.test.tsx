import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountQuotaStrip } from "../src/components/AccountQuotaStrip";
import { TaskHeader } from "../src/components/TaskHeader";

describe("mobile task shell", () => {
  it("shows the compact average quota row and omits an unavailable 5-hour window", () => {
    render(
      <AccountQuotaStrip
        status={{
          state: "assigned",
          accountNumber: 4,
          accountDisplay: "Account 4 (de***@example.com)",
          maskedEmail: "de***@example.com",
          quota5h: null,
          quota7d: { remainingPercent: 96, resetAtMs: 1_784_361_887_165 },
          poolQuota: {
            accountCount: 7,
            fiveHour: null,
            sevenDay: {
              windowMinutes: 10080,
              reportedCount: 7,
              totalRemainingPercent: 412,
              averageRemainingPercent: 58.86,
              earliestResetAtMs: 1_784_487_760_959,
              latestResetAtMs: 1_784_582_025_955
            },
            updatedAt: 1_784_058_257_371
          },
          updatedAt: 1_783_781_435_801,
          stale: false,
          reason: "Saved task assignment"
        }}
        now={1_783_781_500_000}
      />
    );

    expect(screen.getByText("59% quota")).toBeTruthy();
    expect(screen.getByText("7 accounts")).toBeTruthy();
    expect(screen.queryByText("Account 4")).toBeNull();
    expect(screen.queryByText("de***@example.com")).toBeNull();
    expect(screen.queryByText("7d 96%")).toBeNull();
    expect(screen.queryByText(/5h|5-hour/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "59% quota across 7 accounts" }));
    expect(screen.getByText(/7-day.*412% total.*59% average/i)).toBeTruthy();
    expect(screen.getByText(/Account 4/)).toBeTruthy();
    expect(screen.getByText((content) => content.includes("example.com"))).toBeTruthy();
    expect(screen.getByText(/7d 96%/)).toBeTruthy();
    expect(screen.getByText("5-hour · unavailable")).toBeTruthy();
  });

  it("explains why a new task has no account yet", () => {
    render(
      <AccountQuotaStrip
        status={{
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
        }}
        now={1_783_781_500_000}
      />
    );

    expect(screen.getByText("Account pending")).toBeTruthy();
    expect(screen.getByText("Waiting for first routed response")).toBeTruthy();
  });

  it("shows combined usage while a new task is waiting for its first account", () => {
    const rendered = render(
      <AccountQuotaStrip
        status={{
          state: "pending",
          accountNumber: null,
          accountDisplay: null,
          maskedEmail: null,
          quota5h: null,
          quota7d: null,
          poolQuota: {
            accountCount: 7,
            fiveHour: null,
            sevenDay: {
              windowMinutes: 10080,
              reportedCount: 6,
              totalRemainingPercent: 600,
              averageRemainingPercent: 85.71,
              earliestResetAtMs: 1_785_696_316_225,
              latestResetAtMs: 1_785_696_328_240
            },
            updatedAt: 1_785_091_528_240
          },
          updatedAt: null,
          stale: false,
          reason: "Waiting for first routed response"
        }}
        now={1_785_091_600_000}
      />
    );
    const quota = within(rendered.container);

    expect(quota.getByText("86% quota")).toBeTruthy();
    expect(quota.getByText("7 accounts")).toBeTruthy();

    fireEvent.click(quota.getByRole("button", { name: "86% quota across 7 accounts" }));
    expect(quota.getByText(/7-day.*600% total.*86% average.*6 of 7 reported/i)).toBeTruthy();
    expect(quota.getByText("5-hour · unavailable")).toBeTruthy();
    expect(quota.getByText("Waiting for first routed response")).toBeTruthy();
    expect(quota.queryByText(/Account \d/)).toBeNull();
  });

  it("renders a compact task title and connection state", () => {
    render(
      <TaskHeader
        title="Make the UI smart and similar to Codex web"
        connectionState="connected"
        onOpenTasks={() => undefined}
        onRefresh={() => undefined}
      />
    );

    expect(screen.getByText("Make the UI smart and similar to Codex web")).toBeTruthy();
    expect(screen.getByLabelText("Desktop connected")).toBeTruthy();
  });
});
