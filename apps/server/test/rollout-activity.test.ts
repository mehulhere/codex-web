import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enrichThreadActivity,
  RolloutActivityReader
} from "../src/rollout-activity.js";

function writeRollout(lines: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), "codex-mobile-rollout-"));
  const rolloutPath = join(directory, "rollout.jsonl");
  writeFileSync(rolloutPath, `${lines.join("\n")}\n`, "utf8");
  return rolloutPath;
}

describe("RolloutActivityReader", () => {
  it("reports an unfinished latest turn as active", () => {
    const rolloutPath = writeRollout([
      JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }),
      JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-2" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message" } })
    ]);

    expect(new RolloutActivityReader().read(rolloutPath)).toBe("active");
  });

  it.each(["task_complete", "turn_aborted"])(
    "reports %s as inactive",
    (terminalType) => {
      const rolloutPath = writeRollout([
        JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1" } }),
        JSON.stringify({ type: "event_msg", payload: { type: terminalType } })
      ]);

      expect(new RolloutActivityReader().read(rolloutPath)).toBe("inactive");
    }
  );

  it("ignores malformed trailing data and finds the latest lifecycle record", () => {
    const rolloutPath = writeRollout([
      JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1" } }),
      "{truncated"
    ]);

    expect(new RolloutActivityReader().read(rolloutPath)).toBe("active");
  });

  it("scans beyond one read chunk to find the latest turn boundary", () => {
    const rolloutPath = writeRollout([
      JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1" } }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "message", text: "x".repeat(70 * 1024) }
      })
    ]);

    expect(new RolloutActivityReader().read(rolloutPath)).toBe("active");
  });

  it("returns unavailable when the rollout file does not exist", () => {
    expect(new RolloutActivityReader().read("/missing/rollout.jsonl")).toBe("unavailable");
  });

  it("reads indexed rollout activity by thread id", () => {
    const rolloutPath = writeRollout([
      JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1" } })
    ]);
    const reader = new RolloutActivityReader();

    enrichThreadActivity(
      {
        data: [
          {
            id: "desktop-running",
            preview: "Desktop running",
            createdAt: 1,
            updatedAt: 2,
            path: rolloutPath,
            status: { type: "notLoaded" }
          }
        ]
      },
      reader
    );

    expect(reader.readThread("desktop-running")).toBe("active");
    expect(reader.readThread("not-indexed")).toBe("unavailable");
  });

  it("returns the timestamp of the latest indexed lifecycle record", () => {
    const rolloutPath = writeRollout([
      JSON.stringify({
        timestamp: "2026-07-14T10:35:59.009Z",
        type: "turn_context",
        payload: { turn_id: "turn-1" }
      }),
      JSON.stringify({
        timestamp: "2026-07-14T10:36:18.570Z",
        type: "event_msg",
        payload: { type: "task_complete" }
      })
    ]);
    const reader = new RolloutActivityReader();
    reader.rememberThread("thread-1", rolloutPath);

    expect(reader.readThreadLifecycle("thread-1")).toEqual({
      activity: "inactive",
      observedAtMs: Date.parse("2026-07-14T10:36:18.570Z")
    });
    expect(reader.readThreadLifecycle("missing")).toEqual({
      activity: "unavailable",
      observedAtMs: null
    });
  });

  it("invalidates its cache when a terminal record is appended", () => {
    const rolloutPath = writeRollout([
      JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1" } })
    ]);
    const reader = new RolloutActivityReader();

    expect(reader.read(rolloutPath)).toBe("active");
    appendFileSync(
      rolloutPath,
      `${JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })}\n`,
      "utf8"
    );
    expect(reader.read(rolloutPath)).toBe("inactive");
  });

  it("enriches unloaded and stale-idle threads with unfinished rollout turns", () => {
    const activeRolloutPath = writeRollout([
      JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1" } })
    ]);
    const inactiveRolloutPath = writeRollout([
      JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-2" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })
    ]);

    const result = enrichThreadActivity(
      {
        data: [
          {
            id: "desktop-running",
            preview: "Desktop running",
            createdAt: 1,
            updatedAt: 2,
            path: activeRolloutPath,
            status: { type: "notLoaded" }
          },
          {
            id: "desktop-finished",
            preview: "Desktop finished",
            createdAt: 1,
            updatedAt: 2,
            path: inactiveRolloutPath,
            status: { type: "notLoaded" }
          },
          {
            id: "desktop-stale-idle",
            preview: "Desktop stale idle",
            createdAt: 1,
            updatedAt: 2,
            path: activeRolloutPath,
            status: { type: "idle" }
          },
          {
            id: "native-active",
            preview: "Native active",
            createdAt: 1,
            updatedAt: 2,
            status: { type: "active", activeFlags: ["waitingOnUserInput"] }
          }
        ]
      },
      new RolloutActivityReader()
    );

    expect(result.data.map((thread) => thread.status)).toEqual([
      { type: "active", activeFlags: [] },
      { type: "notLoaded" },
      { type: "active", activeFlags: [] },
      { type: "active", activeFlags: ["waitingOnUserInput"] }
    ]);
  });
});
