import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const UnavailableCapabilitySchema = z
  .object({
    available: z.literal(false),
    reason: z.enum(["not-found", "unreadable", "invalid"])
  })
  .strict();

const BatteryCapabilitySchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      percent: z.number().int().min(0).max(100),
      state: z.enum(["charging", "discharging", "full", "not-charging", "unknown"])
    })
    .strict(),
  UnavailableCapabilitySchema
]);

const AcPowerCapabilitySchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      connected: z.boolean()
    })
    .strict(),
  UnavailableCapabilitySchema
]);

const TemperatureCapabilitySchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      celsius: z.number().finite().min(-100).max(250)
    })
    .strict(),
  UnavailableCapabilitySchema
]);

const BrightnessCapabilitySchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      percent: z.number().int().min(0).max(100)
    })
    .strict(),
  UnavailableCapabilitySchema
]);

const SessionCapabilitySchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      active: z.boolean(),
      locked: z.boolean(),
      idle: z.boolean()
    })
    .strict(),
  UnavailableCapabilitySchema
]);

export const DeviceStatusSchema = z
  .object({
    updatedAt: z.string().datetime(),
    machineState: z.literal("awake"),
    battery: BatteryCapabilitySchema,
    acPower: AcPowerCapabilitySchema,
    cpuTemperature: TemperatureCapabilitySchema,
    gpuTemperature: TemperatureCapabilitySchema,
    brightness: BrightnessCapabilitySchema,
    session: SessionCapabilitySchema
  })
  .strict();

export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export type DeviceStatusCommandRunner = (
  executable: string,
  args: readonly string[]
) => Promise<string>;

interface DeviceStatusReadOptions {
  powerSupplyRoot?: string;
  hwmonRoot?: string;
  backlightRoot?: string;
  userId?: number;
  runCommand?: DeviceStatusCommandRunner;
  now?: () => Date;
}

const IntegerTextSchema = z
  .string()
  .trim()
  .regex(/^-?\d+$/u)
  .transform((value) => Number(value))
  .pipe(z.number().int().finite());

const PercentageTextSchema = IntegerTextSchema.pipe(z.number().int().min(0).max(100));

const BinaryTextSchema = z.enum(["0", "1"]).transform((value) => value === "1");

const BatteryStateTextSchema = z
  .enum(["Charging", "Discharging", "Full", "Not charging", "Unknown"])
  .transform((value): "charging" | "discharging" | "full" | "not-charging" | "unknown" => {
    switch (value) {
      case "Charging":
        return "charging";
      case "Discharging":
        return "discharging";
      case "Full":
        return "full";
      case "Not charging":
        return "not-charging";
      case "Unknown":
        return "unknown";
    }
  });

const SessionListLineSchema = z
  .tuple([
    z.string().min(1),
    z.coerce.number().int().nonnegative(),
    z.string().min(1),
    z.literal("seat0")
  ])
  .rest(z.string());

const SessionPropertiesSchema = z
  .object({
    Active: z.enum(["yes", "no"]),
    State: z.string().min(1),
    LockedHint: z.enum(["yes", "no"]),
    IdleHint: z.enum(["yes", "no"])
  })
  .strict();

async function readText(filePath: string): Promise<string | null> {
  try {
    return (await fs.promises.readFile(filePath, "utf8")).trim();
  } catch {
    return null;
  }
}

async function readNames(directoryPath: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(directoryPath)).sort();
  } catch {
    return [];
  }
}

async function runCommand(executable: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      { encoding: "utf8", timeout: 5_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

async function readBattery(powerSupplyRoot: string): Promise<DeviceStatus["battery"]> {
  for (const name of await readNames(powerSupplyRoot)) {
    const supplyPath = path.join(powerSupplyRoot, name);
    if ((await readText(path.join(supplyPath, "type"))) !== "Battery") continue;
    const percent = PercentageTextSchema.safeParse(await readText(path.join(supplyPath, "capacity")));
    const state = BatteryStateTextSchema.safeParse(await readText(path.join(supplyPath, "status")));
    if (!percent.success || !state.success) {
      return { available: false, reason: "invalid" };
    }
    return {
      available: true,
      percent: percent.data,
      state: state.data
    };
  }
  return { available: false, reason: "not-found" };
}

async function readAcPower(powerSupplyRoot: string): Promise<DeviceStatus["acPower"]> {
  for (const name of await readNames(powerSupplyRoot)) {
    const supplyPath = path.join(powerSupplyRoot, name);
    if ((await readText(path.join(supplyPath, "type"))) !== "Mains") continue;
    const connected = BinaryTextSchema.safeParse(await readText(path.join(supplyPath, "online")));
    if (!connected.success) {
      return { available: false, reason: "invalid" };
    }
    return { available: true, connected: connected.data };
  }
  return { available: false, reason: "not-found" };
}

async function readTemperature(
  hwmonRoot: string,
  acceptedDeviceNames: ReadonlySet<string>
): Promise<DeviceStatus["cpuTemperature"]> {
  for (const monitorName of await readNames(hwmonRoot)) {
    const monitorPath = path.join(hwmonRoot, monitorName);
    const deviceName = await readText(path.join(monitorPath, "name"));
    if (!deviceName || !acceptedDeviceNames.has(deviceName)) continue;
    const readings: number[] = [];
    for (const inputName of await readNames(monitorPath)) {
      if (!/^temp\d+_input$/u.test(inputName)) continue;
      const parsed = IntegerTextSchema.safeParse(await readText(path.join(monitorPath, inputName)));
      if (parsed.success) readings.push(parsed.data);
    }
    if (readings.length === 0) {
      return { available: false, reason: "invalid" };
    }
    return {
      available: true,
      celsius: Math.round((Math.max(...readings) / 1_000) * 10) / 10
    };
  }
  return { available: false, reason: "not-found" };
}

async function readBrightness(backlightRoot: string): Promise<DeviceStatus["brightness"]> {
  for (const name of await readNames(backlightRoot)) {
    const backlightPath = path.join(backlightRoot, name);
    const actual = IntegerTextSchema.safeParse(
      await readText(path.join(backlightPath, "actual_brightness"))
    );
    const maximum = IntegerTextSchema.pipe(z.number().int().positive()).safeParse(
      await readText(path.join(backlightPath, "max_brightness"))
    );
    if (!actual.success || !maximum.success) {
      return { available: false, reason: "invalid" };
    }
    return {
      available: true,
      percent: Math.round((actual.data / maximum.data) * 100)
    };
  }
  return { available: false, reason: "not-found" };
}

async function readSession(
  userId: number,
  commandRunner: DeviceStatusCommandRunner
): Promise<DeviceStatus["session"]> {
  try {
    const sessionList = await commandRunner("loginctl", [
      "list-sessions",
      "--no-legend",
      "--no-pager"
    ]);
    let sessionId: string | null = null;
    for (const line of sessionList.split("\n")) {
      const entry = SessionListLineSchema.safeParse(line.trim().split(/\s+/u));
      if (entry.success && entry.data[1] === userId) {
        sessionId = entry.data[0];
        break;
      }
    }
    if (!sessionId) {
      return { available: false, reason: "not-found" };
    }
    const propertiesText = await commandRunner("loginctl", [
      "show-session",
      sessionId,
      "-p",
      "Active",
      "-p",
      "State",
      "-p",
      "LockedHint",
      "-p",
      "IdleHint"
    ]);
    const properties = SessionPropertiesSchema.safeParse(
      Object.fromEntries(
        propertiesText
          .trim()
          .split("\n")
          .map((line) => {
            const separator = line.indexOf("=");
            return [line.slice(0, separator), line.slice(separator + 1)];
          })
      )
    );
    if (!properties.success) {
      return { available: false, reason: "invalid" };
    }
    return {
      available: true,
      active: properties.data.Active === "yes" && properties.data.State === "active",
      locked: properties.data.LockedHint === "yes",
      idle: properties.data.IdleHint === "yes"
    };
  } catch {
    return { available: false, reason: "unreadable" };
  }
}

export async function readDeviceStatus(
  options: DeviceStatusReadOptions = {}
): Promise<DeviceStatus> {
  const powerSupplyRoot = options.powerSupplyRoot ?? "/sys/class/power_supply";
  const hwmonRoot = options.hwmonRoot ?? "/sys/class/hwmon";
  const backlightRoot = options.backlightRoot ?? "/sys/class/backlight";
  const userId = options.userId ?? process.getuid?.() ?? 0;
  const commandRunner = options.runCommand ?? runCommand;
  const now = options.now ?? (() => new Date());

  return DeviceStatusSchema.parse({
    updatedAt: now().toISOString(),
    machineState: "awake",
    battery: await readBattery(powerSupplyRoot),
    acPower: await readAcPower(powerSupplyRoot),
    cpuTemperature: await readTemperature(
      hwmonRoot,
      new Set(["k10temp", "coretemp", "zenpower"])
    ),
    gpuTemperature: await readTemperature(hwmonRoot, new Set(["amdgpu"])),
    brightness: await readBrightness(backlightRoot),
    session: await readSession(userId, commandRunner)
  });
}
