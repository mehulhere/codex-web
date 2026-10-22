import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DeviceStatusSchema,
  readDeviceStatus,
  type DeviceStatusCommandRunner
} from "../src/device-status.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function writeFixtureFile(root: string, relativePath: string, value: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${value}\n`);
}

describe("readDeviceStatus", () => {
  it("reads laptop power, temperatures, brightness, and graphical session state", async () => {
    const root = fs.mkdtempSync(path.join("/tmp", "codex-mobile-device-status-"));
    temporaryDirectories.push(root);
    const powerSupplyRoot = path.join(root, "power_supply");
    const hwmonRoot = path.join(root, "hwmon");
    const backlightRoot = path.join(root, "backlight");

    writeFixtureFile(powerSupplyRoot, "BAT0/type", "Battery");
    writeFixtureFile(powerSupplyRoot, "BAT0/capacity", "73");
    writeFixtureFile(powerSupplyRoot, "BAT0/status", "Discharging");
    writeFixtureFile(powerSupplyRoot, "AC0/type", "Mains");
    writeFixtureFile(powerSupplyRoot, "AC0/online", "0");
    writeFixtureFile(hwmonRoot, "hwmon0/name", "k10temp");
    writeFixtureFile(hwmonRoot, "hwmon0/temp1_label", "Tctl");
    writeFixtureFile(hwmonRoot, "hwmon0/temp1_input", "70375");
    writeFixtureFile(hwmonRoot, "hwmon1/name", "amdgpu");
    writeFixtureFile(hwmonRoot, "hwmon1/temp1_label", "edge");
    writeFixtureFile(hwmonRoot, "hwmon1/temp1_input", "57000");
    writeFixtureFile(backlightRoot, "amdgpu_bl1/actual_brightness", "302757");
    writeFixtureFile(backlightRoot, "amdgpu_bl1/max_brightness", "399000");

    const runCommand: DeviceStatusCommandRunner = async (executable, args) => {
      expect(executable).toBe("loginctl");
      if (args[0] === "list-sessions") {
        return "3 1000 example seat0 3558 user tty2 no -\n";
      }
      expect(args).toEqual([
        "show-session",
        "3",
        "-p",
        "Active",
        "-p",
        "State",
        "-p",
        "LockedHint",
        "-p",
        "IdleHint"
      ]);
      return "Active=yes\nState=active\nLockedHint=no\nIdleHint=no\n";
    };

    const status = await readDeviceStatus({
      powerSupplyRoot,
      hwmonRoot,
      backlightRoot,
      userId: 1000,
      runCommand,
      now: () => new Date("2026-08-01T00:00:00.000Z")
    });

    expect(DeviceStatusSchema.parse(status)).toEqual({
      updatedAt: "2026-08-01T00:00:00.000Z",
      machineState: "awake",
      battery: {
        available: true,
        percent: 73,
        state: "discharging"
      },
      acPower: {
        available: true,
        connected: false
      },
      cpuTemperature: {
        available: true,
        celsius: 70.4
      },
      gpuTemperature: {
        available: true,
        celsius: 57
      },
      brightness: {
        available: true,
        percent: 76
      },
      session: {
        available: true,
        active: true,
        locked: false,
        idle: false
      }
    });
  });

  it("returns explicit unavailable capabilities when host interfaces cannot be read", async () => {
    const root = fs.mkdtempSync(path.join("/tmp", "codex-mobile-device-status-"));
    temporaryDirectories.push(root);
    const runCommand: DeviceStatusCommandRunner = async () => {
      throw new Error("loginctl unavailable");
    };

    const status = await readDeviceStatus({
      powerSupplyRoot: path.join(root, "power_supply"),
      hwmonRoot: path.join(root, "hwmon"),
      backlightRoot: path.join(root, "backlight"),
      userId: 1000,
      runCommand,
      now: () => new Date("2026-08-01T00:00:00.000Z")
    });

    expect(status).toEqual({
      updatedAt: "2026-08-01T00:00:00.000Z",
      machineState: "awake",
      battery: { available: false, reason: "not-found" },
      acPower: { available: false, reason: "not-found" },
      cpuTemperature: { available: false, reason: "not-found" },
      gpuTemperature: { available: false, reason: "not-found" },
      brightness: { available: false, reason: "not-found" },
      session: { available: false, reason: "unreadable" }
    });
  });
});
