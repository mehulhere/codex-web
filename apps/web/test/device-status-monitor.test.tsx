import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDeviceStatus, type DeviceStatus } from "../src/lib/api";
import { useDeviceStatusMonitor } from "../src/hooks/useDeviceStatusMonitor";

vi.mock("../src/lib/api", () => ({ getDeviceStatus: vi.fn() }));
const reading: DeviceStatus = {
  updatedAt: "2026-10-21T00:00:00.000Z", machineState: "awake",
  cpuTemperature: { available: true, celsius: 73 },
  gpuTemperature: { available: false, reason: "not-found" },
  battery: { available: false, reason: "not-found" },
  acPower: { available: false, reason: "not-found" },
  brightness: { available: false, reason: "not-found" },
  session: { available: false, reason: "not-found" }
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getDeviceStatus).mockReset().mockResolvedValue(reading);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("device status monitoring", () => {
  it("is idle until enabled, then refreshes immediately and once a minute", async () => {
    const hook = renderHook(({ enabled }) => useDeviceStatusMonitor(enabled), { initialProps: { enabled: false } });
    expect(getDeviceStatus).not.toHaveBeenCalled();
    hook.rerender({ enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(hook.result.current.status).toEqual(reading);
    expect(getDeviceStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(59_999));
    expect(getDeviceStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getDeviceStatus).toHaveBeenCalledTimes(2);
    hook.rerender({ enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getDeviceStatus).toHaveBeenCalledTimes(2);
  });

  it("does not overlap a slow refresh and marks a timed-out reading unavailable", async () => {
    vi.mocked(getDeviceStatus).mockImplementation(signal => new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    }));
    const hook = renderHook(() => useDeviceStatusMonitor(true));
    act(() => { void hook.result.current.refresh(); });
    expect(getDeviceStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(hook.result.current.error).toContain("unavailable");
    expect(hook.result.current.loading).toBe(false);
  });

  it("refreshes when returning to the PWA and cleans up timers on unmount", async () => {
    const hook = renderHook(() => useDeviceStatusMonitor(true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(getDeviceStatus).toHaveBeenCalledTimes(2);
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(getDeviceStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps the last reading visible if a later refresh fails", async () => {
    const hook = renderHook(() => useDeviceStatusMonitor(true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    vi.mocked(getDeviceStatus).mockRejectedValueOnce(new Error("Offline"));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(hook.result.current.status).toEqual(reading);
    expect(hook.result.current.error).toContain("unavailable");
  });

  it("aborts when disabled and ignores late results from an earlier request", async () => {
    let release: (value: DeviceStatus) => void = () => undefined;
    vi.mocked(getDeviceStatus).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const hook = renderHook(({ enabled }) => useDeviceStatusMonitor(enabled), { initialProps: { enabled: true } });
    const firstSignal = vi.mocked(getDeviceStatus).mock.calls[0]?.[0];
    hook.rerender({ enabled: false });
    expect(firstSignal?.aborted).toBe(true);
    hook.rerender({ enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(async () => release({ ...reading, cpuTemperature: { available: true, celsius: 99 } }));
    expect(hook.result.current.status).toEqual(reading);
    expect(hook.result.current.error).toBeNull();
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
