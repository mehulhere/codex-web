import { describe, expect, it } from "vitest";
import { ByteBoundedBuffer } from "../src/byte-bounded-buffer.js";

describe("byte-bounded diagnostic retention", () => {
  it("evicts oldest payloads by total size even below the count limit", () => {
    const buffer = new ByteBoundedBuffer<string>(2_000, 10);
    buffer.push("old", 7);
    buffer.push("recent", 5);
    expect(buffer.values()).toEqual(["recent"]);
    expect(buffer.retainedBytes).toBe(5);
  });

  it("bounds tiny entries by count and resets accounting on clear", () => {
    const buffer = new ByteBoundedBuffer<string>(2, 10);
    buffer.push("a", 1);
    buffer.push("b", 1);
    buffer.push("c", 1);
    expect(buffer.values()).toEqual(["b", "c"]);
    expect(buffer.retainedBytes).toBe(2);
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.retainedBytes).toBe(0);
  });

  it("rejects oversized entries without removing useful retained data", () => {
    const buffer = new ByteBoundedBuffer<string>(2, 10);
    buffer.push("small", 3);
    expect(buffer.push("too large", 11)).toBe(false);
    expect(buffer.values()).toEqual(["small"]);
    expect(buffer.retainedBytes).toBe(3);
    expect(() => buffer.push("invalid", -1)).toThrow();
  });
});
