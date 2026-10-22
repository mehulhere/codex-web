import { describe, expect, it, vi } from "vitest";
import { IpcFrameDecoder } from "../src/ipc-frame-decoder.js";

function frame(value: string): Buffer {
  const body = Buffer.from(value);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

describe("IPC framing", () => {
  it("accepts every split position in the length header and UTF-8 body", () => {
    const encoded = frame("A message with emoji: \u{1f389}");
    for (let split = 1; split < encoded.length; split += 1) {
      const decoder = new IpcFrameDecoder(1024);
      const received: string[] = [];
      decoder.push(encoded.subarray(0, split), data => received.push(data.toString()));
      expect(received).toEqual([]);
      decoder.push(encoded.subarray(split), data => received.push(data.toString()));
      expect(received).toEqual(["A message with emoji: \u{1f389}"]);
    }
  });

  it("delivers combined and empty frames exactly once and in order", () => {
    const decoder = new IpcFrameDecoder(1024);
    const received: string[] = [];
    decoder.push(Buffer.concat([frame("first"), frame(""), frame("last")]), data => received.push(data.toString()));
    expect(received).toEqual(["first", "", "last"]);
  });

  it("copies a large fragmented frame body only once", () => {
    const encoded = frame("x".repeat(1024 * 1024));
    const decoder = new IpcFrameDecoder(2 * 1024 * 1024);
    const received = vi.fn();
    const concat = vi.spyOn(Buffer, "concat");
    try {
      for (let offset = 0; offset < encoded.length; offset += 1024) {
        decoder.push(encoded.subarray(offset, offset + 1024), received);
      }
      expect(received).toHaveBeenCalledOnce();
      expect(received.mock.calls[0]?.[0].length).toBe(1024 * 1024);
      expect(concat).toHaveBeenCalledOnce();
    } finally { concat.mockRestore(); }
  });

  it("rejects an oversized length before accepting a body", () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(100_000);
    expect(() => new IpcFrameDecoder(1024).push(header, () => undefined)).toThrow(/exceeded limit/);
  });

  it("discards partial frames on reconnect", () => {
    const decoder = new IpcFrameDecoder(1024);
    const received: string[] = [];
    decoder.push(frame("stale").subarray(0, 6), data => received.push(data.toString()));
    decoder.reset();
    decoder.push(frame("fresh"), data => received.push(data.toString()));
    expect(received).toEqual(["fresh"]);
  });
});
