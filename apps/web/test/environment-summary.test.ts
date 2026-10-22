import { describe, expect, it } from "vitest";
import type { ThreadConversationState } from "@farfield/protocol";
import { buildEnvironmentSummary } from "../src/lib/environmentSummary.js";

describe("buildEnvironmentSummary", () => {
  it("uses latest file diffs and explicit environment metadata", () => {
    const turns: ThreadConversationState["turns"] = [
      {
        status: "completed",
        items: [
          {
            id: "change-1",
            type: "fileChange",
            status: "completed",
            changes: [
              {
                path: "src/app.ts",
                kind: { type: "update" },
                diff: "-old\n+intermediate"
              }
            ]
          }
        ]
      },
      {
        status: "completed",
        items: [
          {
            id: "change-2",
            type: "fileChange",
            status: "completed",
            changes: [
              {
                path: "src/app.ts",
                kind: { type: "update" },
                diff: "-old\n+final\n+extra"
              }
            ]
          }
        ]
      }
    ];

    expect(
      buildEnvironmentSummary({
        branch: "feature/mobile-panel",
        cwd: "/workspace/project",
        turns
      })
    ).toMatchObject({
      branch: "feature/mobile-panel",
      cwd: "/workspace/project",
      changes: { files: 1, added: 2, removed: 1 }
    });
  });

  it("uses each collab agent's latest reported state", () => {
    const turns: ThreadConversationState["turns"] = [
      {
        status: "completed",
        items: [
          {
            id: "agents-1",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: "root",
            receiverThreadIds: ["agent-1", "agent-2"],
            agentsStates: {
              "agent-1": { status: "running" },
              "agent-2": { status: "errored", message: "failed" }
            }
          },
          {
            id: "agents-2",
            type: "collabAgentToolCall",
            tool: "wait",
            status: "completed",
            senderThreadId: "root",
            receiverThreadIds: ["agent-1"],
            agentsStates: {
              "agent-1": { status: "completed" }
            }
          },
          {
            id: "legacy-agent-started",
            type: "subAgentActivity",
            agentPath: "/root/legacy",
            agentThreadId: "agent-3",
            kind: "started"
          },
          {
            id: "legacy-agent-interacted",
            type: "subAgentActivity",
            agentPath: "/root/legacy",
            agentThreadId: "agent-3",
            kind: "interacted"
          }
        ]
      }
    ];

    expect(buildEnvironmentSummary({ branch: null, cwd: null, turns }).subagents).toEqual({
      running: 0,
      done: 2,
      interrupted: 0,
      failed: 1
    });
  });

  it("reports missing metadata without inventing values", () => {
    expect(buildEnvironmentSummary({ branch: null, cwd: null, turns: [] })).toEqual({
      branch: null,
      cwd: null,
      changes: { files: 0, added: 0, removed: 0 },
      subagents: { running: 0, done: 0, interrupted: 0, failed: 0 }
    });
  });
});
