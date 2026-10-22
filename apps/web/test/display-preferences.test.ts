import { describe, expect, it } from "vitest";
import {
  DisplayPreferencesSchema,
  readDisplayPreferences
} from "../src/display-preferences.js";

describe("display preferences", () => {
  it("defaults to showing reasoning, diffs, and commands", () => {
    expect(readDisplayPreferences(null)).toEqual({
      showReasoning: true,
      showDiffs: true,
      showCommands: true,
      monitorCpuTemperature: false,
      cpuWarningCelsius: 90
    });
  });

  it("parses persisted strict preferences", () => {
    expect(
      readDisplayPreferences(JSON.stringify({
        showReasoning: false,
        showDiffs: false,
        showCommands: false
      }))
    ).toEqual({ showReasoning: false, showDiffs: false, showCommands: false, monitorCpuTemperature: false, cpuWarningCelsius: 90 });
  });

  it("keeps commands visible for preferences saved before the command toggle existed", () => {
    expect(
      readDisplayPreferences(JSON.stringify({ showReasoning: false, showDiffs: false }))
    ).toEqual({ showReasoning: false, showDiffs: false, showCommands: true, monitorCpuTemperature: false, cpuWarningCelsius: 90 });
  });

  it("persists the opt-in monitor and selected warning level", () => {
    const value = { showReasoning: true, showDiffs: true, showCommands: true, monitorCpuTemperature: true, cpuWarningCelsius: 85 };
    expect(readDisplayPreferences(JSON.stringify(value))).toEqual(value);
    expect(() => DisplayPreferencesSchema.parse({ ...value, cpuWarningCelsius: 900 })).toThrow();
  });

  it("rejects additional persisted fields", () => {
    expect(() =>
      DisplayPreferencesSchema.parse({
        showReasoning: true,
        showDiffs: true,
        showCommands: true,
        extra: true
      })
    ).toThrowError();
  });
});
