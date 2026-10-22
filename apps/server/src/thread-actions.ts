import type { AppServerClient, CodexMonitorService } from "@farfield/api";
import {
  createSideConversation,
  editLastAppServerUserMessage,
  type SideConversationResult
} from "./side-conversation.js";
import type { MessageDelivery } from "./thread-owner.js";

type ActionService = Pick<
  CodexMonitorService,
  "compactThread" | "editLastUserMessage" | "openSideThread"
>;

type ActionAppClient = Pick<
  AppServerClient,
  | "compactThread"
  | "readThread"
  | "rollbackThread"
  | "startTurnWithInput"
  | "forkThread"
  | "injectThreadItems"
>;

interface OwnedThreadActionInput {
  threadId: string;
  delivery: MessageDelivery;
  service: ActionService;
  appClient: ActionAppClient;
}

interface EditLastMessageInput extends OwnedThreadActionInput {
  turnId: string;
  message: string;
}

interface SideThreadInput extends OwnedThreadActionInput {
  cwd: string;
}

interface ForkThreadInput {
  threadId: string;
  turnId: string;
  appClient: Pick<AppServerClient, "forkThread">;
}

export async function executeCompactThread(input: OwnedThreadActionInput): Promise<void> {
  if (input.delivery.type === "desktop") {
    await input.service.compactThread({
      threadId: input.threadId,
      ownerClientId: input.delivery.ownerClientId
    });
    return;
  }
  await input.appClient.compactThread(input.threadId);
}

export async function executeEditLastMessage(input: EditLastMessageInput): Promise<void> {
  if (input.delivery.type === "desktop") {
    await input.service.editLastUserMessage({
      threadId: input.threadId,
      ownerClientId: input.delivery.ownerClientId,
      turnId: input.turnId,
      message: input.message
    });
    return;
  }
  await editLastAppServerUserMessage(
    input.appClient,
    input.threadId,
    input.turnId,
    input.message
  );
}

export async function executeSideThread(
  input: SideThreadInput
): Promise<SideConversationResult> {
  if (input.delivery.type === "desktop") {
    return {
      threadId: await input.service.openSideThread({
        threadId: input.threadId,
        ownerClientId: input.delivery.ownerClientId
      }),
      title: "Side conversation"
    };
  }
  return createSideConversation(input.appClient, input.threadId, input.cwd);
}

export async function executeForkThread(input: ForkThreadInput): Promise<string> {
  const result = await input.appClient.forkThread({
    threadId: input.threadId,
    lastTurnId: input.turnId,
    excludeTurns: true
  });
  return result.thread.id;
}
