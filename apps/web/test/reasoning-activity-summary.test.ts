import { describe, expect, it } from "vitest";
import { TurnItemSchema } from "@farfield/protocol";
import {
  activeThinkingCue,
  latestReasoningIndex,
  reasoningActivityItems,
  reasoningActivitySummary
} from "../src/lib/reasoningActivitySummary.js";

describe("reasoning activity summary", () => {
  it("derives a live cue from an active tool when no reasoning summary is present", () => {
    const items = [
      TurnItemSchema.parse({
        id: "command-1",
        type: "commandExecution",
        command: "sed -n '1,80p' src/file.ts",
        status: "inProgress",
        commandActions: [{ type: "read", path: "src/file.ts" }]
      })
    ];

    expect(activeThinkingCue(items)).toBe("Reading files");
  });

  it("prefers the latest reasoning summary for the live cue", () => {
    const items = [
      TurnItemSchema.parse({
        id: "reasoning-1",
        type: "reasoning",
        summary: ["Inspecting the stream"]
      }),
      TurnItemSchema.parse({
        id: "command-1",
        type: "commandExecution",
        command: "pnpm test",
        status: "inProgress"
      })
    ];

    expect(activeThinkingCue(items)).toBe("Inspecting the stream");
  });

  it("summarizes activity across commentary and stops at the next reasoning item", () => {
    const items = [
      TurnItemSchema.parse({
        id: "reasoning-1",
        type: "reasoning",
        summary: ["Investigating storage"]
      }),
      TurnItemSchema.parse({
        id: "commentary-before-tools",
        type: "agentMessage",
        text: "I found the stale storage write.",
        phase: "commentary"
      }),
      TurnItemSchema.parse({
        id: "command-read",
        type: "commandExecution",
        command: "sed -n '1,80p' src/storage.ts",
        status: "completed",
        commandActions: [{ type: "read", path: "src/storage.ts" }]
      }),
      TurnItemSchema.parse({
        id: "change-1",
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "src/storage.ts",
            kind: { type: "update" },
            diff: "-old\n+new"
          }
        ]
      }),
      TurnItemSchema.parse({
        id: "command-test",
        type: "commandExecution",
        command: "pnpm test",
        status: "completed"
      }),
      TurnItemSchema.parse({ id: "reasoning-2", type: "reasoning", summary: ["Verifying"] }),
      TurnItemSchema.parse({
        id: "command-after-boundary",
        type: "commandExecution",
        command: "git status",
        status: "completed"
      })
    ];

    expect(reasoningActivitySummary(items, 0)).toBe(
      "Edited files, read files, ran commands"
    );
    expect(reasoningActivityItems(items, 0).map((item) => item.id)).toEqual([
      "command-read",
      "change-1",
      "command-test"
    ]);
  });

  it("deduplicates searches and identifies the newest reasoning item", () => {
    const items = [
      TurnItemSchema.parse({ id: "reasoning-1", type: "reasoning", summary: ["First"] }),
      TurnItemSchema.parse({
        id: "search-command",
        type: "commandExecution",
        command: "rg storage src",
        status: "completed",
        commandActions: [{ type: "search", query: "storage" }]
      }),
      TurnItemSchema.parse({
        id: "web-search",
        type: "webSearch",
        query: "Codex protocol",
        action: { type: "search", query: "Codex protocol" }
      }),
      TurnItemSchema.parse({ id: "reasoning-2", type: "reasoning", summary: ["Second"] })
    ];

    expect(reasoningActivitySummary(items, 0)).toBe("Searched");
    expect(latestReasoningIndex(items)).toBe(3);
  });

  it("returns no summary when completed reasoning has no following activity", () => {
    const items = [
      TurnItemSchema.parse({ id: "reasoning-1", type: "reasoning", summary: ["Private"] }),
      TurnItemSchema.parse({
        id: "assistant-1",
        type: "agentMessage",
        text: "Visible update",
        phase: "commentary"
      })
    ];

    expect(reasoningActivitySummary(items, 0)).toBeNull();
    expect(reasoningActivityItems(items, 0)).toEqual([]);
  });
});
