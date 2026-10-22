import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_AUTO_RETRY_STORAGE_KEY,
  readConnectionAutoRetry,
  writeConnectionAutoRetry
} from "../src/connection-retry-storage.js";

describe("connection retry preference", () => {
  it("restores only the enabled value", () => {
    const getItem = vi.fn((key: string): string | null =>
      key === CONNECTION_AUTO_RETRY_STORAGE_KEY ? "enabled" : null
    );

    expect(readConnectionAutoRetry({ getItem })).toBe(true);
    getItem.mockReturnValue("invalid");
    expect(readConnectionAutoRetry({ getItem })).toBe(false);
  });

  it("persists both preference states", () => {
    const setItem = vi.fn();

    writeConnectionAutoRetry({ setItem }, true);
    writeConnectionAutoRetry({ setItem }, false);

    expect(setItem).toHaveBeenNthCalledWith(
      1,
      CONNECTION_AUTO_RETRY_STORAGE_KEY,
      "enabled"
    );
    expect(setItem).toHaveBeenNthCalledWith(
      2,
      CONNECTION_AUTO_RETRY_STORAGE_KEY,
      "disabled"
    );
  });
});
