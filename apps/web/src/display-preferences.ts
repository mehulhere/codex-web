import { z } from "zod";

export const CpuWarningCelsiusSchema = z.union([
  z.literal(70), z.literal(75), z.literal(80), z.literal(85),
  z.literal(90), z.literal(95), z.literal(100)
]);

export const DisplayPreferencesSchema = z
  .object({
    showReasoning: z.boolean(),
    showDiffs: z.boolean(),
    showCommands: z.boolean().default(true),
    monitorCpuTemperature: z.boolean().default(false),
    cpuWarningCelsius: CpuWarningCelsiusSchema.default(90)
  })
  .strict();

export type DisplayPreferences = z.infer<typeof DisplayPreferencesSchema>;

export const DefaultDisplayPreferences: DisplayPreferences = {
  showReasoning: true,
  showDiffs: true,
  showCommands: true,
  monitorCpuTemperature: false,
  cpuWarningCelsius: 90
};

export function readDisplayPreferences(value: string | null): DisplayPreferences {
  if (value === null) {
    return DefaultDisplayPreferences;
  }
  return DisplayPreferencesSchema.parse(JSON.parse(value));
}
