import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  DesktopAppendQueuedFollowUpResponseSchema,
  DesktopComposerDraftResponseSchema,
  DesktopSteeringRestoreContextSchema,
  DesktopSteeringRestoreMessageSchema,
  DesktopTypeAndSubmitMessageResponseSchema,
  type TurnStartParams,
  type CollaborationMode,
  type QueuedFollowUpMessage,
  type SharedComposerDraft,
  parseUserInputResponsePayload,
  SharedComposerDraftSchema,
  TextQueuedFollowUpContextSchema,
  type UserInputResponsePayload
} from "@farfield/protocol";
import { z } from "zod";
import type { DesktopIpcClient } from "./ipc-client.js";

const DESKTOP_NATIVE_SUBMISSION_TIMEOUT_MS = 4_000;

const DesktopSideThreadResponseSchema = z
  .object({
    conversationId: z.string().min(1)
  })
  .strict();

const DesktopOwnerDiscoveryResponseSchema = z
  .object({
    handledByClientId: z.string().trim().min(1)
  })
  .strict();

const DesktopHandlerResponseSchema = z
  .object({
    handledByClientId: z.string().trim().min(1).optional()
  })
  .strict();

interface SendMessageBaseInput {
  threadId: string;
  ownerClientId: string;
  text: string;
  imagePaths?: readonly string[];
  cwd?: string;
  turnStartTemplate: TurnStartParams;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: CollaborationMode | null;
}

export type SendMessageInput =
  | (SendMessageBaseInput & {
      isSteering: true;
      restoreMessage: QueuedFollowUpMessage;
    })
  | (SendMessageBaseInput & {
      isSteering?: false;
      restoreMessage?: never;
    });

export interface SetModeInput {
  threadId: string;
  ownerClientId: string;
  collaborationMode: CollaborationMode;
}

export interface SubmitUserInputInput {
  threadId: string;
  ownerClientId: string;
  requestId: number;
  response: UserInputResponsePayload;
}

export interface InterruptInput {
  threadId: string;
  ownerClientId?: string;
}

export interface ThreadOwnerInput {
  threadId: string;
  ownerClientId: string;
}

export interface EditLastUserMessageInput extends ThreadOwnerInput {
  turnId: string;
  message: string;
}

export interface SetQueuedFollowUpsInput {
  threadId: string;
  ownerClientId?: string;
  messages: QueuedFollowUpMessage[];
}

export interface DesktopQueueImageInput {
  id: string;
  path: string;
  filename: string;
}

export interface EnqueueDesktopFollowUpInput extends SetQueuedFollowUpsInput {
  text: string;
  cwd: string;
  images?: readonly DesktopQueueImageInput[];
}

export interface AppendDesktopFollowUpInput {
  threadId: string;
  ownerClientId?: string;
  text: string;
  cwd: string;
  images?: readonly DesktopQueueImageInput[];
}

export interface DesktopQueueAcknowledgement {
  ownerClientId: string;
  messages: QueuedFollowUpMessage[];
}

export interface DesktopDraftInput {
  threadId: string;
  ownerClientId?: string;
}

export interface SetDesktopDraftInput extends DesktopDraftInput {
  draft: SharedComposerDraft;
}

export interface DesktopDraftAcknowledgement {
  ownerClientId: string;
  draft: SharedComposerDraft;
}

export interface TypeAndSubmitDesktopMessageInput {
  threadId: string;
  text: string;
}

export interface DesktopMessageSubmissionAcknowledgement {
  ownerClientId: string;
  conversationId: string;
}

function createDesktopQueuedFollowUp(
  textInput: string,
  cwdInput: string,
  images: readonly DesktopQueueImageInput[] = []
): QueuedFollowUpMessage {
  const text = textInput.trim();
  if (!text && images.length === 0) {
    throw new Error("Message text or image is required");
  }
  const cwd = cwdInput.trim();
  if (!cwd) {
    throw new Error("Queued message cwd is required");
  }

  const context = TextQueuedFollowUpContextSchema.parse({
    prompt: text,
    addedFiles: [],
    fileAttachments: [],
    ideContext: null,
    imageAttachments: images.map((image) => ({
      id: image.id,
      src: pathToFileURL(image.path).href,
      localPath: image.path,
      filename: image.filename,
      uploadStatus: "complete"
    })),
    workspaceRoots: [cwd]
  });
  return {
    id: randomUUID(),
    text,
    context,
    cwd,
    createdAt: Date.now()
  };
}

function createDesktopSteeringRestoreMessage(message: QueuedFollowUpMessage) {
  const currentContext = DesktopSteeringRestoreContextSchema.safeParse(message.context);
  const context = currentContext.success
    ? currentContext.data
    : (() => {
        const legacyContext = TextQueuedFollowUpContextSchema.parse(message.context);
        return DesktopSteeringRestoreContextSchema.parse({
          ...legacyContext,
          chatGptConversationContexts: [],
          imageCommentDrafts: [],
          appshotContexts: [],
          pastedTextAttachments: [],
          inAppBrowserContext: null,
          commentAttachments: [],
          mcpAppModelContextAttachments: [],
          selectedTextAttachments: [],
          responseTextAnnotations: [],
          pullRequestChecks: [],
          pullRequestMergeConflict: null,
          threadReferences: []
        });
      })();
  return DesktopSteeringRestoreMessageSchema.parse({
    ...message,
    context
  });
}

function resolveAcknowledgedDesktopOwner(
  ownerClientId: string | undefined,
  handledByClientId: string | undefined,
  threadId: string
): string {
  const targetedOwner = ownerClientId?.trim();
  if (targetedOwner) {
    return targetedOwner;
  }
  const response = DesktopHandlerResponseSchema.parse({ handledByClientId });
  if (!response.handledByClientId) {
    throw new Error(`Desktop did not identify an owner for task ${threadId}`);
  }
  return response.handledByClientId;
}

export class CodexMonitorService {
  private readonly ipcClient: DesktopIpcClient;

  public constructor(ipcClient: DesktopIpcClient) {
    this.ipcClient = ipcClient;
  }

  public async sendMessage(input: SendMessageInput): Promise<void> {
    const text = input.text.trim();
    const steeringRestoreMessage = input.isSteering
      ? createDesktopSteeringRestoreMessage(input.restoreMessage)
      : null;
    const imagePaths = input.imagePaths ??
      steeringRestoreMessage?.context.imageAttachments.map((image) => image.localPath) ??
      [];
    const userInput: TurnStartParams["input"] = [];
    if (text) {
      userInput.push({ type: "text", text, text_elements: [] });
    }
    for (const imagePath of imagePaths) {
      const normalizedPath = imagePath.trim();
      if (!normalizedPath) throw new Error("Local image path is required");
      userInput.push({ type: "localImage", path: normalizedPath });
    }
    if (userInput.length === 0) {
      throw new Error("Message text or image is required");
    }

    const template = input.turnStartTemplate;

    const turnStartParams = {
      ...template,
      threadId: input.threadId,
      input: userInput,
      cwd: input.cwd ?? template.cwd,
      attachments: Array.isArray(template.attachments) ? template.attachments : []
    };

    if (Object.prototype.hasOwnProperty.call(input, "model")) {
      turnStartParams.model = input.model ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "effort")) {
      turnStartParams.effort = input.effort ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "collaborationMode")) {
      turnStartParams.collaborationMode = input.collaborationMode ?? null;
    }

    if (input.isSteering) {
      await this.ipcClient.sendRequestAndWait(
        "thread-follower-steer-turn",
        {
          conversationId: input.threadId,
          input: userInput,
          restoreMessage: steeringRestoreMessage,
          serviceTier: null,
          attachments: [],
          clientUserMessageId: null
        },
        {
          targetClientId: input.ownerClientId,
          version: 1
        }
      );
      return;
    }

    await this.ipcClient.sendRequestAndWait(
      "thread-follower-start-turn",
      {
        conversationId: input.threadId,
        turnStartParams,
        isSteering: false
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }

  public createDesktopFollowUpMessage(input: {
    text: string;
    cwd: string;
    images?: readonly DesktopQueueImageInput[];
  }): QueuedFollowUpMessage {
    return createDesktopQueuedFollowUp(input.text, input.cwd, input.images);
  }

  public setQueuedFollowUps(input: SetQueuedFollowUpsInput): void {
    this.ipcClient.sendBroadcast(
      "thread-queued-followups-changed",
      {
        conversationId: input.threadId,
        messages: input.messages
      },
      input.ownerClientId
        ? { targetClientIds: [input.ownerClientId], version: 1 }
        : { version: 1 }
    );
  }

  public async discoverThreadOwner(threadId: string): Promise<string> {
    const response = await this.ipcClient.sendRequestAndWait(
      "thread-follower-load-complete-history",
      { conversationId: threadId },
      { version: 1 }
    );
    const parsed = DesktopOwnerDiscoveryResponseSchema.safeParse({
      handledByClientId: response.handledByClientId
    });
    if (!parsed.success) {
      throw new Error(`Desktop did not identify an owner for task ${threadId}`);
    }
    return parsed.data.handledByClientId;
  }

  public enqueueDesktopFollowUp(
    input: EnqueueDesktopFollowUpInput
  ): QueuedFollowUpMessage[] {
    const message = createDesktopQueuedFollowUp(input.text, input.cwd, input.images);
    const messages: QueuedFollowUpMessage[] = [
      ...input.messages,
      message
    ];
    this.setQueuedFollowUps({
      threadId: input.threadId,
      ...(input.ownerClientId ? { ownerClientId: input.ownerClientId } : {}),
      messages
    });
    return messages;
  }

  public async appendDesktopFollowUp(
    input: AppendDesktopFollowUpInput
  ): Promise<DesktopQueueAcknowledgement> {
    const message = createDesktopQueuedFollowUp(input.text, input.cwd, input.images);
    const response = await this.ipcClient.sendRequestAndWait(
      "thread-follower-append-queued-follow-up",
      {
        conversationId: input.threadId,
        message
      },
      input.ownerClientId
        ? { targetClientId: input.ownerClientId, version: 1 }
        : { version: 1 }
    );
    const result = DesktopAppendQueuedFollowUpResponseSchema.parse(response.result);
    return {
      ownerClientId: resolveAcknowledgedDesktopOwner(
        input.ownerClientId,
        response.handledByClientId,
        input.threadId
      ),
      messages: result.messages
    };
  }

  public async readDesktopDraft(
    input: DesktopDraftInput
  ): Promise<DesktopDraftAcknowledgement> {
    const response = await this.ipcClient.sendRequestAndWait(
      "thread-follower-read-composer-draft",
      { conversationId: input.threadId },
      input.ownerClientId
        ? { targetClientId: input.ownerClientId, version: 1 }
        : { version: 1 }
    );
    const result = DesktopComposerDraftResponseSchema.parse(response.result);
    return {
      ownerClientId: resolveAcknowledgedDesktopOwner(
        input.ownerClientId,
        response.handledByClientId,
        input.threadId
      ),
      draft: result.draft
    };
  }

  public async setDesktopDraft(
    input: SetDesktopDraftInput
  ): Promise<DesktopDraftAcknowledgement> {
    const draft = SharedComposerDraftSchema.parse(input.draft);
    const response = await this.ipcClient.sendRequestAndWait(
      "thread-follower-set-composer-draft",
      {
        conversationId: input.threadId,
        draft
      },
      input.ownerClientId
        ? { targetClientId: input.ownerClientId, version: 1 }
        : { version: 1 }
    );
    const result = DesktopComposerDraftResponseSchema.parse(response.result);
    return {
      ownerClientId: resolveAcknowledgedDesktopOwner(
        input.ownerClientId,
        response.handledByClientId,
        input.threadId
      ),
      draft: result.draft
    };
  }

  public async typeAndSubmitDesktopMessage(
    input: TypeAndSubmitDesktopMessageInput
  ): Promise<DesktopMessageSubmissionAcknowledgement> {
    if (!input.text.trim()) {
      throw new Error("Message text is required");
    }
    const response = await this.ipcClient.sendRequestAndWait(
      "thread-follower-type-and-submit-message",
      {
        conversationId: input.threadId,
        text: input.text
      },
      { version: 1, timeoutMs: DESKTOP_NATIVE_SUBMISSION_TIMEOUT_MS }
    );
    const result = DesktopTypeAndSubmitMessageResponseSchema.parse(response.result);
    if (result.conversationId !== input.threadId) {
      throw new Error(
        `Desktop acknowledged message submission for a different task: ${result.conversationId}`
      );
    }
    return {
      ownerClientId: resolveAcknowledgedDesktopOwner(
        undefined,
        response.handledByClientId,
        input.threadId
      ),
      conversationId: result.conversationId
    };
  }

  public async setCollaborationMode(input: SetModeInput): Promise<void> {
    await this.ipcClient.sendRequestAndWait(
      "thread-follower-set-collaboration-mode",
      {
        conversationId: input.threadId,
        collaborationMode: input.collaborationMode
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }

  public async submitUserInput(input: SubmitUserInputInput): Promise<void> {
    const payload = parseUserInputResponsePayload(input.response);

    await this.ipcClient.sendRequestAndWait(
      "thread-follower-submit-user-input",
      {
        conversationId: input.threadId,
        requestId: input.requestId,
        response: payload
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }

  public async interrupt(input: InterruptInput): Promise<void> {
    await this.ipcClient.sendRequestAndWait(
      "thread-follower-interrupt-turn",
      {
        conversationId: input.threadId
      },
      input.ownerClientId
        ? { targetClientId: input.ownerClientId, version: 2 }
        : { version: 2 }
    );
  }

  public async compactThread(input: ThreadOwnerInput): Promise<void> {
    await this.ipcClient.sendRequestAndWait(
      "thread-follower-compact-thread",
      {
        conversationId: input.threadId
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }

  public async editLastUserMessage(input: EditLastUserMessageInput): Promise<void> {
    const message = input.message.trim();
    if (!message) {
      throw new Error("Edited message text is required");
    }

    await this.ipcClient.sendRequestAndWait(
      "thread-follower-edit-last-user-turn",
      {
        conversationId: input.threadId,
        turnId: input.turnId,
        message,
        agentMode: null,
        shouldSendPermissionOverrides: false,
        serviceTier: null
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }

  public async openSideThread(input: ThreadOwnerInput): Promise<string> {
    const response = await this.ipcClient.sendRequestAndWait(
      "thread-follower-open-side-chat",
      {
        conversationId: input.threadId
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
    return DesktopSideThreadResponseSchema.parse(response.result).conversationId;
  }
}
