import {
  AppServerQueueListResponseSchema,
  AppServerQueueWriteResponseSchema,
  AppServerQueueDeleteResponseSchema,
  AppServerQueueChangedNotificationSchema,
  AppServerQueueInputSchema,
  type AppServerQueuedSubmission,
  type AppServerCollaborationModeListResponse,
  AppServerCollaborationModeListResponseSchema,
  type AppServerListModelsResponse,
  AppServerListModelsResponseSchema,
  type AppServerListThreadsResponse,
  AppServerListThreadsResponseSchema,
  type AppServerReadThreadResponse,
  AppServerReadThreadResponseSchema,
  type AppServerResumeThreadResponse,
  AppServerResumeThreadRequestSchema,
  AppServerResumeThreadResponseSchema,
  AppServerThreadCompactRequestSchema,
  AppServerThreadCompactResponseSchema,
  AppServerThreadDeleteRequestSchema,
  AppServerThreadDeleteResponseSchema,
  type AppServerThreadForkResponse,
  AppServerThreadForkRequestSchema,
  AppServerThreadForkResponseSchema,
  AppServerThreadInjectItemsRequestSchema,
  AppServerThreadInjectItemsResponseSchema,
  type AppServerThreadRollbackResponse,
  AppServerThreadRollbackRequestSchema,
  AppServerThreadRollbackResponseSchema,
  type AppServerThreadUnsubscribeResponse,
  AppServerThreadUnsubscribeRequestSchema,
  AppServerThreadUnsubscribeResponseSchema,
  AppServerThreadSettingsUpdateRequestSchema,
  AppServerThreadSettingsUpdateResponseSchema,
  type AppServerTurnCompletedNotification,
  AppServerTurnCompletedNotificationSchema,
  type AppServerStartThreadResponse,
  AppServerStartThreadRequestSchema,
  AppServerStartThreadResponseSchema,
  AppServerTurnStartRequestSchema,
  AppServerTurnStartResponseSchema,
  AppServerTurnSteerRequestSchema,
  AppServerTurnSteerResponseSchema,
  AppServerTurnInterruptRequestSchema,
  AppServerTurnInterruptResponseSchema
} from "@farfield/protocol";
import { ProtocolValidationError, type ThreadConversationState } from "@farfield/protocol";
import { z } from "zod";
import {
  AppServerTransport,
  ChildProcessAppServerTransport,
  type ChildProcessAppServerTransportOptions
} from "./app-server-transport.js";

function parseWithSchema<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  context: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw ProtocolValidationError.fromZod(context, parsed.error);
  }
  return parsed.data;
}

export interface ListThreadsOptions {
  limit: number;
  archived: boolean;
  cursor?: string;
}

function deduplicateThreadList(
  items: AppServerListThreadsResponse["data"]
): AppServerListThreadsResponse["data"] {
  const threads = new Map<string, AppServerListThreadsResponse["data"][number]>();
  for (const item of items) {
    const current = threads.get(item.id);
    if (!current || item.updatedAt > current.updatedAt) threads.set(item.id, item);
  }
  return [...threads.values()];
}

export interface ListThreadsAllOptions {
  limit: number;
  archived: boolean;
  cursor?: string;
  maxPages: number;
}

export interface StartThreadOptions {
  cwd: string;
  model?: string;
  modelProvider?: string;
  personality?: string;
  sandbox?: string;
  approvalPolicy?: string;
  ephemeral?: boolean;
}

export interface ThreadSettings {
  model: string;
  modelProvider: string | null;
  reasoningEffort: string | null;
}

export type UpdateThreadSettingsOptions = z.infer<
  typeof AppServerThreadSettingsUpdateRequestSchema
>;

export type ForkThreadOptions = z.infer<typeof AppServerThreadForkRequestSchema>;
export type SideBoundaryItem = z.infer<typeof AppServerThreadInjectItemsRequestSchema>["items"][number];
export type StartTurnInput = z.infer<typeof AppServerTurnStartRequestSchema>["input"][number];
export type StartTurnAttachment = NonNullable<
  z.infer<typeof AppServerTurnStartRequestSchema>["attachments"]
>[number];

function buildUserInput(text: string, imagePaths: readonly string[]): StartTurnInput[] {
  const input: StartTurnInput[] = [];
  if (text.trim()) {
    input.push({ type: "text", text, text_elements: [] });
  }
  for (const imagePath of imagePaths) {
    const normalizedPath = imagePath.trim();
    if (!normalizedPath) throw new Error("Local image path is required");
    input.push({ type: "localImage", path: normalizedPath });
  }
  if (input.length === 0) throw new Error("Message text or image is required");
  return input;
}

export class AppServerClient {
  private readonly transport: AppServerTransport;

  public constructor(transportOrOptions: AppServerTransport | ChildProcessAppServerTransportOptions) {
    if ("request" in transportOrOptions && "close" in transportOrOptions) {
      this.transport = transportOrOptions;
      return;
    }

    this.transport = new ChildProcessAppServerTransport(transportOrOptions);
  }

  public async close(): Promise<void> {
    await this.transport.close();
  }

  public async listQueuedSubmissions(threadId: string): Promise<AppServerQueuedSubmission[]> {
    const data: AppServerQueuedSubmission[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const result = await this.transport.request("thread/queue/list", { threadId, limit: 100, cursor });
      const page = AppServerQueueListResponseSchema.parse(result);
      data.push(...page.data);
      cursor = page.nextCursor;
      if (cursor !== null) {
        if (seen.has(cursor)) throw new Error("Thread queue pagination repeated a cursor");
        seen.add(cursor);
      }
    } while (cursor !== null);
    return data;
  }

  public async addQueuedSubmission(threadId: string, input: AppServerQueuedSubmission["input"], clientUserMessageId: string): Promise<AppServerQueuedSubmission> {
    const result = await this.transport.request("thread/queue/add", { threadId, input: z.array(AppServerQueueInputSchema).parse(input), clientUserMessageId });
    return AppServerQueueWriteResponseSchema.parse(result).queuedSubmission;
  }

  public async updateQueuedSubmission(threadId: string, queuedSubmissionId: string, input: AppServerQueuedSubmission["input"]): Promise<AppServerQueuedSubmission> {
    const result = await this.transport.request("thread/queue/update", { threadId, queuedSubmissionId, input: z.array(AppServerQueueInputSchema).parse(input) });
    return AppServerQueueWriteResponseSchema.parse(result).queuedSubmission;
  }

  public async deleteQueuedSubmission(threadId: string, queuedSubmissionId: string): Promise<boolean> {
    return AppServerQueueDeleteResponseSchema.parse(await this.transport.request("thread/queue/delete", { threadId, queuedSubmissionId })).deleted;
  }

  public async sendQueuedSubmissionNow(threadId: string, submission: AppServerQueuedSubmission): Promise<void> {
    const expectedTurnId = await this.getActiveTurnId(threadId);
    if (expectedTurnId) {
      AppServerTurnSteerResponseSchema.parse(await this.transport.request("turn/steer", {
        threadId, expectedTurnId, input: submission.input, clientUserMessageId: submission.clientUserMessageId
      }));
      await this.deleteQueuedSubmission(threadId, submission.id);
    } else {
      AppServerTurnStartResponseSchema.parse(await this.transport.request("thread/queue/start", {
        threadId, queuedSubmissionId: submission.id
      }));
    }
  }

  public onQueueChanged(listener: (threadId: string) => void): () => void {
    const subscribe = this.transport.onNotification;
    if (!subscribe) throw new Error("App-server transport does not publish notifications");
    return subscribe.call(this.transport, notification => {
      if (notification.method === "thread/queue/changed") listener(AppServerQueueChangedNotificationSchema.parse(notification.params).threadId);
    });
  }

  public async listThreads(options: ListThreadsOptions): Promise<AppServerListThreadsResponse> {
    const result = await this.transport.request("thread/list", {
      limit: options.limit,
      archived: options.archived,
      cursor: options.cursor ?? null,
      modelProviders: []
    });

    const parsed = parseWithSchema(AppServerListThreadsResponseSchema, result, "AppServerListThreadsResponse");
    return { ...parsed, data: deduplicateThreadList(parsed.data) };
  }

  public async listThreadsAll(options: ListThreadsAllOptions): Promise<AppServerListThreadsResponse> {
    const listItems: AppServerListThreadsResponse["data"] = [];

    let cursor = options.cursor;
    let pages = 0;

    while (pages < options.maxPages) {
      const page = await this.listThreads(
        cursor
          ? {
              limit: options.limit,
              archived: options.archived,
              cursor
            }
          : {
              limit: options.limit,
              archived: options.archived
            }
      );

      listItems.push(...page.data);
      pages += 1;

      const nextCursor = page.nextCursor ?? null;
      if (!nextCursor || page.data.length === 0) {
        return {
          data: deduplicateThreadList(listItems),
          nextCursor: null,
          pages,
          truncated: false
        };
      }

      cursor = nextCursor;
    }

    return {
      data: deduplicateThreadList(listItems),
      nextCursor: cursor ?? null,
      pages,
      truncated: true
    };
  }

  public async readThread(threadId: string, includeTurns = true): Promise<AppServerReadThreadResponse> {
    const result = await this.transport.request("thread/read", {
      threadId,
      includeTurns
    });

    return parseWithSchema(AppServerReadThreadResponseSchema, result, "AppServerReadThreadResponse");
  }

  public async listModels(limit = 100): Promise<AppServerListModelsResponse> {
    const result = await this.transport.request("model/list", { limit });
    return parseWithSchema(AppServerListModelsResponseSchema, result, "AppServerListModelsResponse");
  }

  public async listCollaborationModes(): Promise<AppServerCollaborationModeListResponse> {
    const result = await this.transport.request("collaborationMode/list", {});
    return parseWithSchema(
      AppServerCollaborationModeListResponseSchema,
      result,
      "AppServerCollaborationModeListResponse"
    );
  }

  public async startThread(options: StartThreadOptions): Promise<AppServerStartThreadResponse> {
    const request = AppServerStartThreadRequestSchema.parse(options);
    const result = await this.transport.request("thread/start", request);
    return parseWithSchema(AppServerStartThreadResponseSchema, result, "AppServerStartThreadResponse");
  }

  public async resumeThread(threadId: string): Promise<AppServerResumeThreadResponse> {
    const request = AppServerResumeThreadRequestSchema.parse({
      threadId
    });
    const result = await this.transport.request("thread/resume", request);
    return parseWithSchema(AppServerResumeThreadResponseSchema, result, "AppServerResumeThreadResponse");
  }

  public async unsubscribeThread(threadId: string): Promise<AppServerThreadUnsubscribeResponse> {
    const request = AppServerThreadUnsubscribeRequestSchema.parse({ threadId });
    const result = await this.transport.request("thread/unsubscribe", request);
    return parseWithSchema(
      AppServerThreadUnsubscribeResponseSchema,
      result,
      "AppServerThreadUnsubscribeResponse"
    );
  }

  public onTurnCompleted(
    listener: (notification: AppServerTurnCompletedNotification) => void
  ): () => void {
    const subscribe = this.transport.onNotification;
    if (!subscribe) {
      throw new Error("App-server transport does not publish notifications");
    }
    return subscribe.call(this.transport, (notification) => {
      if (notification.method !== "turn/completed") {
        return;
      }
      listener(
        parseWithSchema(
          AppServerTurnCompletedNotificationSchema,
          notification.params,
          "AppServerTurnCompletedNotification"
        )
      );
    });
  }

  public async resumeThreadMetadata(threadId: string): Promise<AppServerResumeThreadResponse> {
    const request = AppServerResumeThreadRequestSchema.parse({
      threadId,
      excludeTurns: true
    });
    const result = await this.transport.request("thread/resume", request);
    return parseWithSchema(
      AppServerResumeThreadResponseSchema,
      result,
      "AppServerResumeThreadResponse"
    );
  }

  public async readThreadSettings(
    threadId: string,
    started?: AppServerStartThreadResponse,
    liveState?: ThreadConversationState
  ): Promise<ThreadSettings> {
    if (liveState) {
      if (liveState.id !== threadId) {
        throw new Error(`live settings belong to ${liveState.id}, not ${threadId}`);
      }
      return {
        model:
          liveState.latestCollaborationMode?.settings.model ??
          liveState.latestModel ??
          liveState.previousTurnModel ??
          "",
        modelProvider: null,
        reasoningEffort:
          liveState.latestCollaborationMode?.settings.reasoning_effort ??
          liveState.latestReasoningEffort ??
          null
      };
    }

    const settings = started;
    if (settings) {
      if (settings.thread.id !== threadId) {
        throw new Error(
          `thread/start settings belong to ${settings.thread.id}, not ${threadId}`
        );
      }
    } else {
      const { thread } = await this.readThread(threadId, false);
      if (thread.id !== threadId) {
        throw new Error(`thread/read settings belong to ${thread.id}, not ${threadId}`);
      }
      return {
        model: thread.model ?? "",
        modelProvider: thread.modelProvider ?? null,
        reasoningEffort: thread.reasoningEffort ?? null
      };
    }

    return {
      model: settings.model ?? "",
      modelProvider: settings.modelProvider ?? null,
      reasoningEffort: settings.reasoningEffort ?? null
    };
  }

  public async updateThreadSettings(options: UpdateThreadSettingsOptions): Promise<void> {
    const request = AppServerThreadSettingsUpdateRequestSchema.parse(options);
    const result = await this.transport.request("thread/settings/update", request);
    parseWithSchema(
      AppServerThreadSettingsUpdateResponseSchema,
      result,
      "AppServerThreadSettingsUpdateResponse"
    );
  }

  public async deleteThread(threadId: string): Promise<void> {
    const request = AppServerThreadDeleteRequestSchema.parse({ threadId });
    const result = await this.transport.request("thread/delete", request);
    parseWithSchema(AppServerThreadDeleteResponseSchema, result, "AppServerThreadDeleteResponse");
  }

  public async forkThread(options: ForkThreadOptions): Promise<AppServerThreadForkResponse> {
    const request = AppServerThreadForkRequestSchema.parse(options);
    const result = await this.transport.request("thread/fork", request);
    return parseWithSchema(
      AppServerThreadForkResponseSchema,
      result,
      "AppServerThreadForkResponse"
    );
  }

  public async injectThreadItems(threadId: string, items: SideBoundaryItem[]): Promise<void> {
    const request = AppServerThreadInjectItemsRequestSchema.parse({ threadId, items });
    const result = await this.transport.request("thread/inject_items", request);
    parseWithSchema(
      AppServerThreadInjectItemsResponseSchema,
      result,
      "AppServerThreadInjectItemsResponse"
    );
  }

  public async rollbackThread(
    threadId: string,
    numTurns: number
  ): Promise<AppServerThreadRollbackResponse> {
    const request = AppServerThreadRollbackRequestSchema.parse({ threadId, numTurns });
    const result = await this.transport.request("thread/rollback", request);
    return parseWithSchema(
      AppServerThreadRollbackResponseSchema,
      result,
      "AppServerThreadRollbackResponse"
    );
  }

  public async compactThread(threadId: string): Promise<void> {
    const request = AppServerThreadCompactRequestSchema.parse({ threadId });
    const result = await this.transport.request("thread/compact/start", request);
    parseWithSchema(
      AppServerThreadCompactResponseSchema,
      result,
      "AppServerThreadCompactResponse"
    );
  }

  public async startTurnWithInput(
    threadId: string,
    input: StartTurnInput[],
    attachments: StartTurnAttachment[]
  ): Promise<void> {
    const request = AppServerTurnStartRequestSchema.parse({ threadId, input, attachments });
    const result = await this.transport.request("turn/start", request);
    parseWithSchema(AppServerTurnStartResponseSchema, result, "AppServerTurnStartResponse");
  }

  public async sendUserMessage(
    threadId: string,
    text: string,
    imagePaths: readonly string[] = []
  ): Promise<void> {
    const resume = await this.resumeThreadMetadata(threadId);
    await this.sendUserMessageWithSettings(resume, text, imagePaths, "thread/resume");
  }

  public async steerUserMessage(
    threadId: string,
    text: string,
    imagePaths: readonly string[] = []
  ): Promise<void> {
    const expectedTurnId = await this.getActiveTurnId(threadId);
    if (!expectedTurnId) {
      throw new Error(`Cannot steer thread without an active turn: ${threadId}`);
    }
    const request = AppServerTurnSteerRequestSchema.parse({
      threadId,
      input: buildUserInput(text, imagePaths),
      expectedTurnId
    });
    const result = await this.transport.request("turn/steer", request);
    parseWithSchema(AppServerTurnSteerResponseSchema, result, "AppServerTurnSteerResponse");
  }

  public async getActiveTurnId(threadId: string): Promise<string | null> {
    const state = await this.readThread(threadId, true);
    for (let index = state.thread.turns.length - 1; index >= 0; index -= 1) {
      const turn = state.thread.turns[index];
      if (!turn || (turn.status !== "inProgress" && turn.status !== "in-progress")) continue;
      return turn.id ?? turn.turnId ?? null;
    }
    return null;
  }

  public async interruptTurn(threadId: string): Promise<void> {
    const turnId = await this.getActiveTurnId(threadId);
    if (!turnId) {
      throw new Error(`Cannot interrupt thread without an active turn: ${threadId}`);
    }
    const request = AppServerTurnInterruptRequestSchema.parse({ threadId, turnId });
    const result = await this.transport.request("turn/interrupt", request);
    parseWithSchema(AppServerTurnInterruptResponseSchema, result, "AppServerTurnInterruptResponse");
  }

  public async sendInitialUserMessage(
    started: AppServerStartThreadResponse,
    text: string,
    imagePaths: readonly string[] = []
  ): Promise<void> {
    await this.sendUserMessageWithSettings(started, text, imagePaths, "thread/start");
  }

  private async sendUserMessageWithSettings(
    settings: AppServerStartThreadResponse,
    text: string,
    imagePaths: readonly string[],
    sourceMethod: "thread/start" | "thread/resume"
  ): Promise<void> {
    if (!settings.sandbox) {
      throw new Error(`${sourceMethod} did not return required field: sandbox`);
    }

    const request = AppServerTurnStartRequestSchema.parse({
      threadId: settings.thread.id,
      input: buildUserInput(text, imagePaths)
    });

    const result = await this.transport.request("turn/start", request);
    parseWithSchema(AppServerTurnStartResponseSchema, result, "AppServerTurnStartResponse");
  }
}
