import { describe, expect, it, vi } from "vitest";
import {
  LAST_THREAD_STORAGE_KEY,
  readLastThreadId,
  writeLastThreadId
} from "../src/last-thread-storage.js";

describe("last thread storage", () => {
  it("reads a non-empty saved thread ID", () => {
    const storage = { getItem: vi.fn(() => "thread-2") };

    expect(readLastThreadId(storage)).toBe("thread-2");
  });

  it("rejects an empty saved thread ID", () => {
    const storage = { getItem: vi.fn(() => "") };

    expect(readLastThreadId(storage)).toBeNull();
  });

  it("writes and clears the selected thread ID", () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };

    writeLastThreadId(storage, "thread-2");
    expect(storage.setItem).toHaveBeenCalledWith(LAST_THREAD_STORAGE_KEY, "thread-2");

    writeLastThreadId(storage, null);
    expect(storage.removeItem).toHaveBeenCalledWith(LAST_THREAD_STORAGE_KEY);
  });
});
