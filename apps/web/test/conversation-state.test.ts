import { describe, expect, it } from "vitest";
import type { ThreadConversationState } from "@farfield/protocol";
import { mergeConversationStates } from "../src/lib/conversationState.js";

function userMessage(id: string, text: string) {
  return {
    id,
    type: "userMessage" as const,
    content: [{ type: "text" as const, text }]
  };
}

function agentMessage(id: string, text: string) {
  return {
    id,
    type: "agentMessage" as const,
    text
  };
}

describe("mergeConversationStates", () => {
  it("keeps durable-only turns while using richer matching live turns", () => {
    const durable: ThreadConversationState = {
      id: "thread-1",
      updatedAt: 100,
      requests: [],
      turns: [
        {
          id: "turn-desktop",
          status: "completed",
          items: [userMessage("user-desktop", "Desktop message")]
        },
        {
          id: "turn-mobile",
          status: "completed",
          items: [
            userMessage("user-mobile", "Mobile message"),
            agentMessage("agent-mobile", "Mobile reply")
          ]
        },
        {
          id: "turn-current",
          status: "interrupted",
          items: [userMessage("user-current", "Current message")]
        }
      ]
    };
    const live: ThreadConversationState = {
      id: "thread-1",
      updatedAt: 200,
      requests: [],
      turns: [
        {
          turnId: "turn-desktop",
          status: "completed",
          items: [
            userMessage("user-desktop", "Desktop message"),
            agentMessage("agent-desktop", "Desktop reply")
          ]
        },
        {
          turnId: "turn-current",
          status: "inProgress",
          items: [
            userMessage("user-current", "Current message"),
            agentMessage("agent-current", "Current partial reply")
          ]
        }
      ]
    };

    const merged = mergeConversationStates(live, durable);

    expect(merged?.updatedAt).toBe(200);
    expect(merged?.turns.map((turn) => turn.turnId ?? turn.id)).toEqual([
      "turn-desktop",
      "turn-mobile",
      "turn-current"
    ]);
    expect(merged?.turns[0]?.items).toHaveLength(2);
    expect(merged?.turns[1]?.items).toEqual(durable.turns[1]?.items);
    expect(merged?.turns[2]).toMatchObject({
      turnId: "turn-current",
      status: "inProgress"
    });
  });

  it("appends a live-only turn without duplicating turns with id and turnId forms", () => {
    const durable: ThreadConversationState = {
      id: "thread-1",
      updatedAt: 100,
      requests: [],
      turns: [
        {
          id: "turn-shared",
          status: "completed",
          items: [userMessage("user-shared", "Shared")]
        }
      ]
    };
    const live: ThreadConversationState = {
      id: "thread-1",
      updatedAt: 200,
      requests: [],
      turns: [
        {
          turnId: "turn-shared",
          status: "completed",
          items: [userMessage("user-shared", "Shared")]
        },
        {
          turnId: "turn-live",
          status: "inProgress",
          items: [userMessage("user-live", "Live")]
        }
      ]
    };

    const merged = mergeConversationStates(live, durable);

    expect(merged?.turns.map((turn) => turn.turnId ?? turn.id)).toEqual([
      "turn-shared",
      "turn-live"
    ]);
  });
});
