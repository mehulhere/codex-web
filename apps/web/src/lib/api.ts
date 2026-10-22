import { CliPendingRequestSchema } from "@farfield/protocol";
import {
  AppServerCollaborationModeListResponseSchema,
  AppServerListModelsResponseSchema,
  AppServerThreadListItemSchema,
  AppServerListThreadsResponseSchema,
  AppServerReadThreadResponseSchema,
  AppServerStartThreadResponseSchema,
  type CollaborationMode,
  JsonValueSchema,
  ThreadConversationStateSchema,
  UserInputRequestSchema,
  UserInputResponsePayloadSchema
} from "@farfield/protocol";
import { z } from "zod";

const ApiErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_EXPIRED",
  "DEBUG_DISABLED_REMOTE"
]);

const ThreadSidebarMetadataSchema = z
  .object({
    isPinned: z.boolean(),
    isProjectPinned: z.boolean(),
    isProjectless: z.boolean(),
    projectPath: z.string().nullable(),
    projectName: z.string().trim().min(1).nullable().default(null),
    projectOrder: z.number().int().nonnegative().nullable(),
    hasUnreadTurn: z.boolean()
  })
  .strict();

const PublicThreadListItemSchema = AppServerThreadListItemSchema.extend({
  sidebar: ThreadSidebarMetadataSchema.default({
    isPinned: false,
    isProjectPinned: false,
    isProjectless: false,
    projectPath: null,
    projectName: null,
    projectOrder: null,
    hasUnreadTurn: false
  })
}).strict();

const PublicThreadListResponseSchema = AppServerListThreadsResponseSchema.extend({
  data: z.array(PublicThreadListItemSchema)
}).strict();

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

const ApiEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    code: ApiErrorCodeSchema.optional()
  })
  .passthrough();

const HealthResponseSchema = z
  .object({
    ok: z.literal(true),
    state: z
      .object({
        appReady: z.boolean(),
        ipcConnected: z.boolean(),
        ipcInitialized: z.boolean(),
        requiresAuth: z.boolean(),
        multiAccount: z.boolean(),
        cliOnly: z.boolean().default(false)
      })
      .strict()
  })
  .strict();

const ComposerImageSchema = z
  .object({
    id: z.string().uuid(),
    filename: z.string().min(1),
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]),
    size: z.number().int().positive(),
    url: z.string().startsWith("/api/uploads/")
  })
  .strict();

export type ComposerImage = z.infer<typeof ComposerImageSchema>;

const LiveStateResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    ownerClientId: z.string().nullable(),
    conversationState: z.union([ThreadConversationStateSchema, z.null()]),
    cliRequests: z.array(CliPendingRequestSchema).optional(),
    queuedFollowUps: z
      .array(
        z
          .object({
            id: z.string().min(1),
            text: z.string(),
            createdAt: z.number().finite().nonnegative(),
            images: z.array(ComposerImageSchema).default([]),
            pausedReason: z.string().min(1).optional()
          })
          .strict()
      )
      .default([])
  })
  .strict();

const QueuedFollowUpActionResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string().min(1),
    messageId: z.string().min(1)
  })
  .strict();

const QueuedFollowUpsResponseSchema = z.object({
  ok: z.literal(true), threadId: z.string(), ownerClientId: z.string().nullable(),
  messages: LiveStateResponseSchema.shape.queuedFollowUps
}).strict();

export async function getQueuedFollowUps(threadId: string) {
  return QueuedFollowUpsResponseSchema.parse(await request(`/api/threads/${encodeURIComponent(threadId)}/queue`));
}

const MessageReceiptResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string().min(1),
    ownerClientId: z.string().min(1).nullable()
  })
  .strict();

const ComposerImageUploadResponseSchema = z
  .object({
    ok: z.literal(true),
    image: ComposerImageSchema
  })
  .strict();

const StreamEventsResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    ownerClientId: z.string().nullable(),
    events: z.array(JsonValueSchema)
  })
  .strict();

const CreateThreadResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string()
  })
  .merge(AppServerStartThreadResponseSchema)
  .strict();

const AuthSessionResponseSchema = z
  .object({
    ok: z.literal(true),
    authenticated: z.boolean(),
    expiresAt: z.string().nullable(),
    requiresAuth: z.boolean(),
    remoteRequest: z.boolean(),
    debugAvailable: z.boolean(),
    fullControlAvailable: z.literal(true)
  })
  .strict();

const AuthLoginResponseSchema = z
  .object({
    ok: z.literal(true),
    expiresAt: z.string().nullable()
  })
  .strict();

const RemoteStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    tailscaleInstalled: z.boolean(),
    tailscaleIps: z.array(z.string()),
    host: z.string(),
    port: z.number().int().positive()
  })
  .strict();

const UnavailableDeviceCapabilitySchema = z
  .object({
    available: z.literal(false),
    reason: z.enum(["not-found", "unreadable", "invalid"])
  })
  .strict();

export const DeviceStatusSchema = z
  .object({
    updatedAt: z.string().datetime(),
    machineState: z.literal("awake"),
    battery: z.discriminatedUnion("available", [
      z
        .object({
          available: z.literal(true),
          percent: z.number().int().min(0).max(100),
          state: z.enum(["charging", "discharging", "full", "not-charging", "unknown"])
        })
        .strict(),
      UnavailableDeviceCapabilitySchema
    ]),
    acPower: z.discriminatedUnion("available", [
      z.object({ available: z.literal(true), connected: z.boolean() }).strict(),
      UnavailableDeviceCapabilitySchema
    ]),
    cpuTemperature: z.discriminatedUnion("available", [
      z.object({ available: z.literal(true), celsius: z.number().finite() }).strict(),
      UnavailableDeviceCapabilitySchema
    ]),
    gpuTemperature: z.discriminatedUnion("available", [
      z.object({ available: z.literal(true), celsius: z.number().finite() }).strict(),
      UnavailableDeviceCapabilitySchema
    ]),
    brightness: z.discriminatedUnion("available", [
      z
        .object({
          available: z.literal(true),
          percent: z.number().int().min(0).max(100)
        })
        .strict(),
      UnavailableDeviceCapabilitySchema
    ]),
    session: z.discriminatedUnion("available", [
      z
        .object({
          available: z.literal(true),
          active: z.boolean(),
          locked: z.boolean(),
          idle: z.boolean()
        })
        .strict(),
      UnavailableDeviceCapabilitySchema
    ])
  })
  .strict();

const DeviceStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    status: DeviceStatusSchema
  })
  .strict();

export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

const PublicQuotaSchema = z
  .object({
    remainingPercent: z.number().int().min(0).max(100),
    resetAtMs: z.number().finite().positive().nullable()
  })
  .strict();

const ThreadSettingsResponseSchema = z
  .object({
    ok: z.literal(true),
    model: z.string().min(1),
    modelProvider: z.string().min(1).nullable(),
    reasoningEffort: z.string().min(1).nullable()
  })
  .strict();

const ThreadActionResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string().min(1)
  })
  .strict();

const SideThreadResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string().min(1),
    title: z.string().min(1)
  })
  .strict();

const AccountsStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        ready: z.number().int().nonnegative(),
        delayed: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative()
      })
      .strict(),
    recommendedAccountNumber: z.number().int().positive().nullable(),
    accounts: z.array(
      z
        .object({
          accountNumber: z.number().int().positive(),
          availability: z.enum(["ready", "delayed", "unavailable"]),
          current: z.boolean(),
          riskLevel: z.enum(["low", "medium", "high"]),
          waitMs: z.number().finite().nonnegative(),
          reason: z.string().min(1).nullable()
        })
        .strict()
    )
  })
  .strict();

export type ThreadSettings = z.infer<typeof ThreadSettingsResponseSchema>;
export type AccountsStatus = z.infer<typeof AccountsStatusResponseSchema>;

const UsageResetStatusSchema = z.object({
  available: z.boolean(), availableCount: z.number().int().nonnegative(), eligible: z.boolean(),
  fiveHourRemaining: z.number().min(0).max(100).nullable(), weeklyRemaining: z.number().min(0).max(100).nullable(),
  reason: z.string().nullable()
}).strict();
export type UsageResetStatus = z.infer<typeof UsageResetStatusSchema>;
const UsageResetResponseSchema = z.object({ ok: z.literal(true), status: UsageResetStatusSchema }).strict();
const ConsumeUsageResetResponseSchema = UsageResetResponseSchema.extend({ message: z.string() }).strict();

export async function getUsageResetStatus(threadId: string): Promise<UsageResetStatus> {
  return UsageResetResponseSchema.parse(await request(`/api/accounts/resets?threadId=${encodeURIComponent(threadId)}`)).status;
}

export async function replyToCliRequest(threadId: string, id: string, reply: unknown): Promise<void> {
  await request(`/api/threads/${encodeURIComponent(threadId)}/cli-requests/${encodeURIComponent(id)}`, {
    method: "POST", body: JSON.stringify(reply)
  });
}

export async function consumeUsageReset(threadId: string, idempotencyKey: string) {
  return ConsumeUsageResetResponseSchema.parse(await request("/api/accounts/resets", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId, idempotencyKey, confirmed: true })
  }));
}

export const ThreadAccountStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    state: z.enum(["assigned", "pending", "unavailable"]),
    accountNumber: z.number().int().positive().nullable(),
    accountDisplay: z.string().min(1).nullable(),
    maskedEmail: z.string().min(1).nullable(),
    quota5h: PublicQuotaSchema.nullable(),
    quota7d: PublicQuotaSchema.nullable(),
    poolQuota: z
      .object({
        accountCount: z.number().int().nonnegative(),
        fiveHour: z
          .object({
            windowMinutes: z.number().finite().nonnegative(),
            reportedCount: z.number().int().nonnegative(),
            totalRemainingPercent: z.number().finite().min(0),
            averageRemainingPercent: z.number().finite().min(0).max(100),
            earliestResetAtMs: z.number().finite().positive(),
            latestResetAtMs: z.number().finite().positive()
          })
          .strict()
          .nullable(),
        sevenDay: z
          .object({
            windowMinutes: z.number().finite().nonnegative(),
            reportedCount: z.number().int().nonnegative(),
            totalRemainingPercent: z.number().finite().min(0),
            averageRemainingPercent: z.number().finite().min(0).max(100),
            earliestResetAtMs: z.number().finite().positive(),
            latestResetAtMs: z.number().finite().positive()
          })
          .strict()
          .nullable(),
        updatedAt: z.number().finite().positive()
      })
      .strict()
      .nullable(),
    updatedAt: z.number().finite().positive().nullable(),
    stale: z.boolean(),
    reason: z.string().min(1)
  })
  .strict();

export type ThreadAccountStatus = z.infer<typeof ThreadAccountStatusResponseSchema>;

const TraceStatusSchema = z
  .object({
    ok: z.literal(true),
    active: z
      .object({
        id: z.string(),
        label: z.string(),
        startedAt: z.string(),
        stoppedAt: z.string().nullable(),
        eventCount: z.number().int().nonnegative(),
        path: z.string()
      })
      .nullable(),
    recent: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        startedAt: z.string(),
        stoppedAt: z.string().nullable(),
        eventCount: z.number().int().nonnegative(),
        path: z.string()
      })
    )
  })
  .strict();

const HistoryListSchema = z
  .object({
    ok: z.literal(true),
    history: z.array(
      z.object({
        id: z.string(),
        at: z.string(),
        source: z.enum(["ipc", "app", "system"]),
        direction: z.enum(["in", "out", "system"]),
        payload: z.unknown(),
        meta: z.record(z.unknown())
      })
    )
  })
  .strict();

const HistoryDetailSchema = z
  .object({
    ok: z.literal(true),
    entry: HistoryListSchema.shape.history.element,
    fullPayload: z.unknown()
  })
  .strict();

export class ApiRequestError extends Error {
  public readonly code: ApiErrorCode | null;

  public constructor(message: string, code: ApiErrorCode | null) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

const DEFAULT_INITIAL_SESSION_TIMEOUT_MS = 8_000;

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch (error) {
    if (!response.ok) {
      const statusLabel = response.statusText.trim();
      throw new ApiRequestError(
        `HTTP ${String(response.status)}${statusLabel ? ` ${statusLabel}` : ""}`,
        null
      );
    }
    throw error;
  }
  const envelope = ApiEnvelopeSchema.parse(data);

  if (!response.ok || !envelope.ok) {
    throw new ApiRequestError(envelope.error ?? "Request failed", envelope.code ?? null);
  }

  return data;
}

function stripOk(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const { ok: _ok, ...rest } = value as Record<string, unknown>;
  return rest;
}

export async function getHealth(): Promise<z.infer<typeof HealthResponseSchema>> {
  return HealthResponseSchema.parse(await request("/api/health"));
}

export async function getAuthSession(
  options: { timeoutMs?: number } = {}
): Promise<z.infer<typeof AuthSessionResponseSchema>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_INITIAL_SESSION_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return AuthSessionResponseSchema.parse(
      await request("/api/auth/session", { signal: controller.signal })
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Codex Mobile did not respond within ${String(timeoutMs)} ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function loginWithPin(pin: string): Promise<z.infer<typeof AuthLoginResponseSchema>> {
  const data = await request("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ pin })
  });
  return AuthLoginResponseSchema.parse(data);
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
}

export async function getRemoteStatus(): Promise<z.infer<typeof RemoteStatusResponseSchema>> {
  return RemoteStatusResponseSchema.parse(await request("/api/remote/status"));
}

export async function getDeviceStatus(signal?: AbortSignal): Promise<DeviceStatus> {
  return DeviceStatusResponseSchema.parse(await request("/api/device/status", signal ? { signal } : undefined)).status;
}

export async function getThreadAccountStatus(threadId: string): Promise<ThreadAccountStatus> {
  return ThreadAccountStatusResponseSchema.parse(
    await request(`/api/threads/${encodeURIComponent(threadId)}/account-status`)
  );
}

export async function getAccountsStatus(): Promise<AccountsStatus> {
  return AccountsStatusResponseSchema.parse(await request("/api/accounts/status"));
}

export async function getThreadSettings(threadId: string): Promise<ThreadSettings> {
  return ThreadSettingsResponseSchema.parse(
    await request(`/api/threads/${encodeURIComponent(threadId)}/settings`)
  );
}

export async function updateThreadSettings(input: {
  threadId: string;
  model: string | null;
  effort: string | null;
  collaborationMode: CollaborationMode | null;
}): Promise<void> {
  const { threadId, ...body } = input;
  await request(`/api/threads/${encodeURIComponent(threadId)}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function deleteThread(threadId: string): Promise<void> {
  await request(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE"
  });
}

export async function compactThread(threadId: string): Promise<void> {
  ThreadActionResponseSchema.parse(
    await request(`/api/threads/${encodeURIComponent(threadId)}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
  );
}

export async function editLastMessage(
  threadId: string,
  turnId: string,
  message: string
): Promise<void> {
  ThreadActionResponseSchema.parse(
    await request(`/api/threads/${encodeURIComponent(threadId)}/edit-last-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId, message })
    })
  );
}

export async function forkThreadFromTurn(threadId: string, turnId: string): Promise<string> {
  const response = ThreadActionResponseSchema.parse(
    await request(`/api/threads/${encodeURIComponent(threadId)}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId })
    })
  );
  return response.threadId;
}

export async function createSideThread(
  threadId: string,
  cwd: string
): Promise<z.infer<typeof SideThreadResponseSchema>> {
  return SideThreadResponseSchema.parse(
    await request(`/api/threads/${encodeURIComponent(threadId)}/side`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd })
    })
  );
}

export async function listThreads(options: {
  limit: number;
  archived: boolean;
  all: boolean;
  maxPages: number;
}): Promise<z.infer<typeof PublicThreadListResponseSchema>> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit));
  params.set("archived", options.archived ? "1" : "0");
  params.set("all", options.all ? "1" : "0");
  params.set("maxPages", String(options.maxPages));

  const data = await request(`/api/threads?${params.toString()}`);
  const parsed = PublicThreadListResponseSchema.parse(stripOk(data));
  return {
    ...parsed,
    data: parsed.data.map((thread) => ({
      ...thread,
      sidebar: {
        ...thread.sidebar,
        projectPath:
          thread.sidebar.isProjectless
            ? null
            : thread.sidebar.projectPath ?? thread.cwd ?? thread.path ?? null
      }
    }))
  };
}

export async function readThread(
  threadId: string,
  options?: { includeTurns?: boolean }
): Promise<z.infer<typeof AppServerReadThreadResponseSchema>> {
  const includeTurns = options?.includeTurns ?? true;
  const data = await request(
    `/api/threads/${encodeURIComponent(threadId)}?includeTurns=${includeTurns ? "true" : "false"}`
  );
  return AppServerReadThreadResponseSchema.parse(stripOk(data));
}

export async function createThread(input?: {
  cwd?: string;
  model?: string;
  modelProvider?: string;
  personality?: string;
  sandbox?: string;
  approvalPolicy?: string;
  ephemeral?: boolean;
}): Promise<z.infer<typeof CreateThreadResponseSchema>> {
  const data = await request("/api/threads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input ?? {})
  });
  return CreateThreadResponseSchema.parse(data);
}

export async function listCollaborationModes(): Promise<
  z.infer<typeof AppServerCollaborationModeListResponseSchema>
> {
  const data = await request("/api/collaboration-modes");
  return AppServerCollaborationModeListResponseSchema.parse(stripOk(data));
}

export async function listModels(): Promise<z.infer<typeof AppServerListModelsResponseSchema>> {
  const data = await request("/api/models?limit=200");
  return AppServerListModelsResponseSchema.parse(stripOk(data));
}

export async function getLiveState(threadId: string): Promise<z.infer<typeof LiveStateResponseSchema>> {
  const data = await request(`/api/threads/${encodeURIComponent(threadId)}/live-state`);
  return LiveStateResponseSchema.parse(data);
}

export async function getStreamEvents(threadId: string): Promise<z.infer<typeof StreamEventsResponseSchema>> {
  const data = await request(`/api/threads/${encodeURIComponent(threadId)}/stream-events?limit=80`);
  return StreamEventsResponseSchema.parse(data);
}

export async function sendMessage(input: {
  threadId: string;
  ownerClientId?: string;
  text: string;
  cwd?: string;
  isSteering?: boolean;
  images?: string[];
}): Promise<z.infer<typeof MessageReceiptResponseSchema>> {
  const { threadId, ...body } = input;

  const data = await request(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return MessageReceiptResponseSchema.parse(data);
}

export async function uploadComposerImage(file: File): Promise<ComposerImage> {
  const body = new FormData();
  body.append("image", file, file.name);
  const data = await request("/api/uploads", { method: "POST", body });
  return ComposerImageUploadResponseSchema.parse(data).image;
}

export async function deleteComposerImage(imageId: string): Promise<void> {
  await request(`/api/uploads/${encodeURIComponent(imageId)}`, { method: "DELETE" });
}

export async function editQueuedFollowUp(
  threadId: string,
  messageId: string,
  text: string
): Promise<void> {
  const data = await request(
    `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    }
  );
  QueuedFollowUpActionResponseSchema.parse(data);
}

export async function deleteQueuedFollowUp(
  threadId: string,
  messageId: string
): Promise<void> {
  const data = await request(
    `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(messageId)}`,
    { method: "DELETE" }
  );
  QueuedFollowUpActionResponseSchema.parse(data);
}

export async function steerQueuedFollowUp(
  threadId: string,
  messageId: string
): Promise<void> {
  const data = await request(
    `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(messageId)}/steer`,
    { method: "POST" }
  );
  QueuedFollowUpActionResponseSchema.parse(data);
}

export async function setCollaborationMode(input: {
  threadId: string;
  ownerClientId?: string;
  collaborationMode: CollaborationMode;
}): Promise<void> {
  const { threadId, ...body } = input;

  await request(`/api/threads/${encodeURIComponent(threadId)}/collaboration-mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export async function submitUserInput(input: {
  threadId: string;
  ownerClientId?: string;
  requestId: number;
  response: z.infer<typeof UserInputResponsePayloadSchema>;
}): Promise<void> {
  UserInputResponsePayloadSchema.parse(input.response);

  const { threadId, ...body } = input;

  await request(`/api/threads/${encodeURIComponent(threadId)}/user-input`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export async function interruptThread(input: {
  threadId: string;
  ownerClientId?: string;
}): Promise<void> {
  const { threadId, ...body } = input;

  await request(`/api/threads/${encodeURIComponent(threadId)}/interrupt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export async function getTraceStatus(): Promise<z.infer<typeof TraceStatusSchema>> {
  const data = await request("/api/debug/trace/status");
  return TraceStatusSchema.parse(data);
}

export async function startTrace(label: string): Promise<void> {
  await request("/api/debug/trace/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label })
  });
}

export async function markTrace(note: string): Promise<void> {
  await request("/api/debug/trace/mark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note })
  });
}

export async function stopTrace(): Promise<void> {
  await request("/api/debug/trace/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
}

export async function listDebugHistory(limit = 120): Promise<z.infer<typeof HistoryListSchema>> {
  const data = await request(`/api/debug/history?limit=${String(limit)}`);
  return HistoryListSchema.parse(data);
}

export async function getHistoryEntry(entryId: string): Promise<z.infer<typeof HistoryDetailSchema>> {
  const data = await request(`/api/debug/history/${encodeURIComponent(entryId)}`);
  return HistoryDetailSchema.parse(data);
}

export async function replayHistoryEntry(input: {
  entryId: string;
  waitForResponse: boolean;
}): Promise<unknown> {
  return request("/api/debug/replay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getPendingUserInputRequests(
  conversationState: z.infer<typeof ThreadConversationStateSchema> | null
): z.infer<typeof UserInputRequestSchema>[] {
  if (!conversationState) {
    return [];
  }

  return conversationState.requests.filter((request) => {
    if (request.method !== "item/tool/requestUserInput") {
      return false;
    }
    return request.completed !== true;
  });
}
