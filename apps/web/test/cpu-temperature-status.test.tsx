import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CpuTemperatureStatus } from "../src/components/CpuTemperatureStatus";
import type { DeviceStatus } from "../src/lib/api";

afterEach(cleanup);
function status(celsius: number, ageMs = 0): DeviceStatus {
  return { updatedAt: new Date(Date.now() - ageMs).toISOString(), machineState: "awake",
    cpuTemperature: { available: true, celsius }, gpuTemperature: { available: false, reason: "not-found" },
    battery: { available: false, reason: "not-found" }, acPower: { available: false, reason: "not-found" },
    brightness: { available: false, reason: "not-found" }, session: { available: false, reason: "not-found" } };
}
describe("CPU temperature status", () => {
  it("shows a fresh temperature, last check time, and a warning at the selected level", () => {
    const onSettings = vi.fn();
    render(<CpuTemperatureStatus status={status(90)} error={null} warningCelsius={85} onSettings={onSettings} />);
    expect(screen.getByText("CPU 90°C")).toBeTruthy();
    expect(screen.getByText(/Last checked/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("85°C");
    fireEvent.click(screen.getByRole("button", { name: "CPU temperature settings" }));
    expect(onSettings).toHaveBeenCalledOnce();
  });
  it("does not present old or failed readings as current overheating", () => {
    const view = render(<CpuTemperatureStatus status={status(93)} error="Offline" warningCelsius={90} onSettings={() => undefined} />);
    expect(screen.getByText(/CPU 93°C.*stale/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    view.rerender(<CpuTemperatureStatus status={status(93, 120_000)} error={null} warningCelsius={90} onSettings={() => undefined} />);
    expect(screen.getByText(/CPU 93°C.*stale/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows unsupported sensors explicitly", () => {
    render(<CpuTemperatureStatus status={{ ...status(60), cpuTemperature: { available: false, reason: "not-found" } }}
      error={null} warningCelsius={90} onSettings={() => undefined} />);
    expect(screen.getByText("CPU unavailable")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
