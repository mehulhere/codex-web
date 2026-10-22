import { describe, expect, it } from "vitest";
import { MultiAccountSettingSchema } from "../src/account-mode.js";

describe("multi-account setting", () => {
  it("defaults off and preserves the explicit enabled path", () => {
    expect(MultiAccountSettingSchema.parse(undefined)).toBe(false);
    expect(MultiAccountSettingSchema.parse("false")).toBe(false);
    expect(MultiAccountSettingSchema.parse("true")).toBe(true);
  });
  it("rejects misspelled settings", () => {
    expect(() => MultiAccountSettingSchema.parse("flase")).toThrow();
    expect(() => MultiAccountSettingSchema.parse("1")).toThrow();
  });
});
