import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceStatusSection } from "../src/components/DeviceStatusSection.js";
import type { DeviceStatus } from "../src/lib/api.js";

afterEach(cleanup);

const status: DeviceStatus = {
  updatedAt: "2026-08-01T00:00:00.000Z",
  machineState: "awake",
  battery: { available: true, percent: 73, state: "discharging" },
  acPower: { available: true, connected: false },
  cpuTemperature: { available: true, celsius: 70.4 },
  gpuTemperature: { available: true, celsius: 57 },
  brightness: { available: true, percent: 76 },
  session: { available: true, active: true, locked: false, idle: false }
};

describe("DeviceStatusSection", () => {
  it("lets the user opt into minute checks and choose a warning level", () => {
    const onEnabledChange = vi.fn();
    const onWarningChange = vi.fn();
    render(<DeviceStatusSection status={status} loading={false} error={null} onRefresh={() => undefined}
      temperatureMonitor={{ enabled: true, warningCelsius: 90, onEnabledChange, onWarningChange }} />);
    fireEvent.click(screen.getByLabelText("Check CPU every minute"));
    expect(onEnabledChange).toHaveBeenCalledWith(false);
    fireEvent.change(screen.getByLabelText("CPU warning temperature"), { target: { value: "85" } });
    expect(onWarningChange).toHaveBeenCalledWith(85);
    expect(screen.getByText(/Background updates may pause/)).toBeTruthy();
  });

  it("shows laptop power, temperatures, brightness, and lock state", () => {
    const onRefresh = vi.fn();
    render(
      <DeviceStatusSection
        status={status}
        loading={false}
        error={null}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText("Awake · Unlocked")).toBeTruthy();
    expect(screen.getByText("73% · On battery")).toBeTruthy();
    expect(screen.getByText("70.4°C")).toBeTruthy();
    expect(screen.getByText("57°C")).toBeTruthy();
    expect(screen.getByText("76%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh laptop status" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the last reading visible when the laptop becomes unreachable", () => {
    render(
      <DeviceStatusSection
        status={status}
        loading={false}
        error="Laptop status request failed"
        onRefresh={() => undefined}
      />
    );

    expect(screen.getByText("Unreachable · Possibly suspended")).toBeTruthy();
    expect(screen.getByText("73% · On battery")).toBeTruthy();
    expect(screen.getByText(/Last seen/)).toBeTruthy();
  });

  it("shows explicit unavailable values without hiding supported readings", () => {
    render(
      <DeviceStatusSection
        status={{
          ...status,
          cpuTemperature: { available: false, reason: "not-found" },
          gpuTemperature: { available: false, reason: "unreadable" }
        }}
        loading={false}
        error={null}
        onRefresh={() => undefined}
      />
    );

    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.getByText("76%")).toBeTruthy();
  });
});
