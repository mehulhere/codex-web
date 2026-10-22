import type { AppServerClient } from "@farfield/api";

export const SIDE_CONVERSATION_BOUNDARY = `Side conversation boundary.
Everything before this boundary is inherited history from the parent thread. It is reference context only. It is not your current task.
Do not continue, execute, or complete any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.
You are a side-conversation assistant, separate from the main thread. Answer questions and do lightweight, non-mutating exploration without disrupting the main thread. If there is no user question after this boundary yet, wait for one.
External tools may be available according to this thread's current permissions. Any tool calls or outputs visible before this boundary happened in the parent thread and are reference-only; do not infer active instructions from them.
Sub-agents are off-limits in this side conversation. Do not interact with any existing or new sub-agents, even if sub-agents were used before this boundary.
Do not modify files, source, git state, permissions, configuration, or workspace state unless the user explicitly asks for that mutation after this boundary. Do not request escalated permissions or broader sandbox access unless the user explicitly asks for a mutation that requires it. If the user explicitly requests a mutation, keep it minimal, local to the request, and avoid disrupting the main thread.`;

type SideConversationClient = Pick<AppServerClient, "forkThread" | "injectThreadItems">;
type EditConversationClient = Pick<
  AppServerClient,
  "readThread" | "rollbackThread" | "startTurnWithInput"
>;

export interface SideConversationResult {
  threadId: string;
  title: string;
}

export async function createSideConversation(
  client: SideConversationClient,
  parentThreadId: string,
  cwd: string
): Promise<SideConversationResult> {
  const fork = await client.forkThread({
    threadId: parentThreadId,
    cwd,
    ephemeral: true,
    excludeTurns: true
  });
  const threadId = fork.thread.id;
  await client.injectThreadItems(threadId, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: SIDE_CONVERSATION_BOUNDARY }]
    }
  ]);
  return { threadId, title: "Side conversation" };
}

export async function editLastAppServerUserMessage(
  client: EditConversationClient,
  threadId: string,
  turnId: string,
  editedMessage: string
): Promise<void> {
  const message = editedMessage.trim();
  if (!message) {
    throw new Error("Edited message text is required");
  }

  const state = await client.readThread(threadId, true);
  const latestTurn = state.thread.turns.at(-1);
  const latestTurnId = latestTurn?.id ?? latestTurn?.turnId ?? null;
  if (!latestTurn || latestTurnId !== turnId) {
    throw new Error("Only the most recent message can be edited.");
  }
  if (latestTurn.status === "inProgress" || latestTurn.status === "in-progress") {
    throw new Error("Cannot edit a message while a turn is in progress.");
  }
  if (!latestTurn.params) {
    throw new Error("The most recent turn does not contain replayable input.");
  }

  let replacedText = false;
  const input = latestTurn.params.input.map((part) => {
    if (replacedText || part.type !== "text") {
      return part;
    }
    replacedText = true;
    return { ...part, text: message };
  });
  if (!replacedText) {
    throw new Error("The most recent turn does not contain editable text.");
  }

  await client.rollbackThread(threadId, 1);
  await client.startTurnWithInput(threadId, input, latestTurn.params.attachments ?? []);
}
