import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageResetControls } from "../src/components/UsageResetControls";

const status = { available: true, availableCount: 3, eligible: true, fiveHourRemaining: 5, weeklyRemaining: 60, reason: null };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function response(value: object) { return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }); }

describe("UsageResetControls", () => {
  it("shows current credits and leaves ineligible resets disabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, status: { ...status, eligible: false, fiveHourRemaining: 50 } })));
    render(<UsageResetControls threadId="test-chat" />);
    await screen.findByText("3 resets available");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Use reset" }).disabled).toBe(true);
  });

  it("shows usage even when reset credits are unavailable and allows refreshing", async () => {
    const fetchMock = vi.fn(async () => response({ ok: true, status: { ...status, available: false, availableCount: 0 } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UsageResetControls threadId="test-chat" />);
    await screen.findByText(/5-hour remaining: 5%/);
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Use reset" }).disabled).toBe(true);
  });

  it("never posts a reset when confirmation is cancelled", async () => {
    const fetchMock = vi.fn(async () => response({ ok: true, status }));
    vi.stubGlobal("fetch", fetchMock); vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<UsageResetControls threadId="test-chat" />);
    await screen.findByText("3 resets available");
    fireEvent.click(screen.getByRole("button", { name: "Use reset" }));
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("reuses the persisted attempt key on uncertain retry and refreshes usage after confirmation", async () => {
    const attempts: string[] = [];
    let failed = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        attempts.push(JSON.parse(String(init.body)).idempotencyKey);
        if (!failed) { failed = true; throw new Error("Connection lost"); }
        return response({ ok: true, message: "Reset request completed. Usage has been refreshed.", status: { ...status, availableCount: 2, eligible: false, fiveHourRemaining: 100 } });
      }
      return response({ ok: true, status });
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const first = render(<UsageResetControls threadId="test-chat" />);
    await screen.findByText("3 resets available");
    fireEvent.click(screen.getByRole("button", { name: "Use reset" }));
    await screen.findByText(/Retry keeps the same reset attempt/);
    first.unmount();
    render(<UsageResetControls threadId="test-chat" />);
    await screen.findByText("3 resets available");
    fireEvent.click(screen.getByRole("button", { name: "Retry reset" }));
    await screen.findByText("2 resets available");
    expect(attempts).toHaveLength(2); expect(attempts[0]).toBe(attempts[1]);
    await waitFor(() => expect(localStorage.getItem("farfield.usage-reset-attempt.v1")).toBeNull());
  });
});
