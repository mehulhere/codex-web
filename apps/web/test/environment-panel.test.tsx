import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentPanel } from "../src/components/EnvironmentPanel.js";

afterEach(cleanup);

describe("EnvironmentPanel", () => {
  it("shows task environment, Git workflow entries, and subagent status", () => {
    render(
      <EnvironmentPanel
        summary={{
          branch: "feature/mobile-panel",
          cwd: "/workspace/project",
          changes: { files: 3, added: 42, removed: 7 },
          subagents: { running: 1, done: 2, interrupted: 0, failed: 1 }
        }}
        deviceStatus={{
          machineState: "awake",
          updatedAt: "2030-01-01T10:15:00.000Z",
          battery: { available: true, percent: 73, state: "discharging" },
          acPower: { available: true, connected: false },
          cpuTemperature: { available: true, celsius: 70.4 },
          gpuTemperature: { available: true, celsius: 57 },
          brightness: { available: true, percent: 76 },
          session: { available: true, active: true, locked: false, idle: false }
        }}
        deviceStatusLoading={false}
        deviceStatusError={null}
        onRefreshDeviceStatus={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(screen.getByRole("dialog", { name: "Environment" })).toBeTruthy();
    expect(screen.getByText("3 files changed")).toBeTruthy();
    expect(screen.getByText("+42")).toBeTruthy();
    expect(screen.getByText("−7")).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.getByText("/workspace/project")).toBeTruthy();
    expect(screen.getByText("feature/mobile-panel")).toBeTruthy();
    expect(screen.getByText("Commit or push")).toBeTruthy();
    expect(screen.getByText("Create pull request")).toBeTruthy();
    expect(screen.getByText("1 running")).toBeTruthy();
    expect(screen.getByText("2 done")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(screen.getByText("Awake · Unlocked")).toBeTruthy();
    expect(screen.getByText("73% · On battery")).toBeTruthy();
  });

  it("closes from the explicit close button", () => {
    const onClose = vi.fn();
    render(
      <EnvironmentPanel
        summary={{
          branch: null,
          cwd: null,
          changes: { files: 0, added: 0, removed: 0 },
          subagents: { running: 0, done: 0, interrupted: 0, failed: 0 }
        }}
        deviceStatus={null}
        deviceStatusLoading={false}
        deviceStatusError={null}
        onRefreshDeviceStatus={() => undefined}
        onClose={onClose}
      />
    );

    expect(screen.getAllByText("Not reported")).toHaveLength(2);
    expect(screen.getByText("No subagents")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close environment" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
