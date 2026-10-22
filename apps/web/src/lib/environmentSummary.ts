import type { ThreadConversationState } from "@farfield/protocol";
import { summarizeFileChanges, type FileChangeTotals } from "@/lib/fileChangeSummary";

type CollabAgentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";

export interface SubagentTotals {
  running: number;
  done: number;
  interrupted: number;
  failed: number;
}

export interface EnvironmentSummary {
  branch: string | null;
  cwd: string | null;
  changes: FileChangeTotals;
  subagents: SubagentTotals;
}

export function buildEnvironmentSummary(input: {
  branch: string | null;
  cwd: string | null;
  turns: ThreadConversationState["turns"];
}): EnvironmentSummary {
  const fileChanges = input.turns.flatMap((turn) =>
    turn.items.flatMap((item) => item.type === "fileChange" ? item.changes : [])
  );
  const latestAgentStatus = new Map<string, CollabAgentStatus>();

  for (const turn of input.turns) {
    for (const item of turn.items) {
      if (item.type === "collabAgentToolCall") {
        for (const [agentId, state] of Object.entries(item.agentsStates)) {
          latestAgentStatus.set(agentId, state.status);
        }
      }
      if (item.type === "subAgentActivity") {
        const status: CollabAgentStatus = item.kind === "started"
          ? "running"
          : item.kind === "interacted"
            ? "completed"
            : "interrupted";
        latestAgentStatus.set(item.agentThreadId, status);
      }
    }
  }

  const subagents: SubagentTotals = {
    running: 0,
    done: 0,
    interrupted: 0,
    failed: 0
  };

  for (const status of latestAgentStatus.values()) {
    switch (status) {
      case "pendingInit":
      case "running":
        subagents.running += 1;
        break;
      case "completed":
      case "shutdown":
        subagents.done += 1;
        break;
      case "interrupted":
        subagents.interrupted += 1;
        break;
      case "errored":
      case "notFound":
        subagents.failed += 1;
        break;
    }
  }

  return {
    branch: input.branch,
    cwd: input.cwd,
    changes: summarizeFileChanges(fileChanges),
    subagents
  };
}
