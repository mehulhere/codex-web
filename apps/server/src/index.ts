import { multiAccountEnabled } from "./account-mode.js";
import http, { type ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  AppServerClient,
  AppServerRpcError,
  AppServerTransportError,
  CodexMonitorService,
  DesktopIpcClient,
  projectLiveConversationState,
  ThreadStreamReductionError,
  ThreadStreamStateAccumulator,
  type SendBroadcastOptions,
  type SendRequestOptions
} from "@farfield/api";
import {
  type AppServerResumeThreadResponse,
  type AppServerListThreadsResponse,
  type AppServerStartThreadResponse,
  type CollaborationMode,
  type IpcBroadcastFrame,
  IpcBroadcastFrameSchema,
  type IpcFrame,
  type ThreadConversationState,
  type TurnStartParams,
  TurnStartParamsSchema,
  parseThreadComposerDraftChangedBroadcast,
  parseThreadQueuedFollowUpsChangedBroadcast,
  parseThreadStreamStateChangedBroadcast,
  parseUserInputResponsePayload
} from "@farfield/protocol";
import {
  type AuthErrorCode,
  AuthService
} from "./auth.js";
import {
  AuthSessionResponseSchema,
  AccountsStatusResponseSchema,
  AuthErrorBodySchema,
  CompactThreadBodySchema,
  ClientErrorBodySchema,
  DeviceStatusResponseSchema,
  EditLastMessageBodySchema,
  EditQueuedFollowUpBodySchema,
  ForkThreadBodySchema,
  HealthResponseSchema,
  ImageUploadResponseSchema,
  InterruptBodySchema,
  LoginBodySchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  parseBody,
  RemoteStatusResponseSchema,
  ReplayBodySchema,
  SendMessageBodySchema,
  StartThreadBodySchema,
  SetModeBodySchema,
  SideThreadBodySchema,
  SideThreadResponseSchema,
  SubmitUserInputBodySchema,
  ThreadAccountStatusResponseSchema,
  ThreadActionResponseSchema,
  ThreadMediaRouteSchema,
  ThreadSettingsResponseSchema,
  QueuedFollowUpActionResponseSchema,
  QueuedFollowUpsResponseSchema,
  TraceMarkBodySchema,
  TraceStartBodySchema,
  UpdateThreadSettingsBodySchema
} from "./http-schemas.js";
import { readDeviceStatus } from "./device-status.js";
import { readAccountsStatus, readThreadAccountStatus } from "./multi-auth-status.js";
import { ConsumeUsageResetBodySchema, DesktopUsageResets } from "./desktop-usage-resets.js";
import { z } from "zod";
import { parseMultipartImageUpload } from "./image-upload-http.js";
import { ImageUploadStore, type ImageUploadMetadata } from "./image-upload-store.js";
import { logger } from "./logger.js";
import { ThreadStreamStabilityDiagnostics } from "./stability-diagnostics.js";
import {
  getRequestNetworkInfo
} from "./network.js";
import {
  getRemoteStatusSnapshot
} from "./remote-status.js";
import {
  applyDesktopOwnershipEvidence,
  composerMessageDeliveryUnavailableReason,
  interruptDeliveryUnavailableReason,
  messageDeliveryUnavailableReason,
  resolveComposerMessageDelivery,
  resolveInterruptDelivery,
  resolveMessageDelivery,
  resolveSideMessageDelivery
} from "./thread-owner.js";
import {
  AppServerFollowUpQueue,
  type QueuedImage
} from "./app-server-follow-up-queue.js";
import {
  DesktopFollowUpQueue,
  queuedFollowUpImageIds,
  mergeQueuedFollowUps,
  withQueuedFollowUpText
} from "./desktop-follow-up-queue.js";
import { enrichThreadActivity, RolloutActivityReader } from "./rollout-activity.js";
import {
  desktopComposerSubmissionNeedsResume,
  executeComposerMessageDelivery,
  resolveDesktopComposerOwner,
  resolveDesktopComposerSubmission
} from "./composer-message-delivery.js";
import { OwnerDiscoveryCoordinator } from "./owner-discovery.js";
import {
  DesktopSidebarStateReader,
  resolveThreadSidebarMetadata
} from "./desktop-sidebar-state.js";
import { encodeSseEvent, registerSseClient, writeSseEvent } from "./sse.js";
import { ByteBoundedBuffer } from "./byte-bounded-buffer.js";
import { serveStaticWeb } from "./static-web.js";
import { closeHttpServer } from "./http-shutdown.js";
import {
  executeCompactThread,
  executeEditLastMessage,
  executeForkThread,
  executeSideThread
} from "./thread-actions.js";
import {
  materializeThreadImage,
  resolveCurrentThreadImage,
  ThreadMediaNotFoundError
} from "./thread-media.js";
import {
  resolveThreadVisualizationPath,
  resolveThreadVisualizationPreviewPath
} from "./visualization-media.js";
import { renderVisualizationPreview } from "./visualization-preview.js";
import { createConditionalJsonResponse } from "./http-cache.js";
import {
  API_SECURITY_HEADERS,
  TRACE_SECURITY_HEADERS,
  HttpRequestError,
  createPrivateAppendStream,
  ensurePrivateDirectory,
  isPublicApiPath,
  parseBoundedInteger,
  readLimitedJsonBody
} from "./http-security.js";

const HOST = process.env["HOST"] ?? "127.0.0.1";
const PORT = Number(process.env["PORT"] ?? 4311);
const SERVE_WEB = process.env["FARFIELD_SERVE_WEB"] === "1";
const WEB_ROOT = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const authService = new AuthService(HOST);
const authConfig = authService.getConfig();
const HISTORY_LIMIT = 2_000;
const USER_AGENT = "farfield/0.2.0";
const IPC_RECONNECT_DELAY_MS = 1_000;
const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const LOG_RAW_PROTOCOL_ERRORS = process.env["FARFIELD_LOG_RAW_PROTOCOL_ERRORS"] === "1";

const TRACE_DIR = path.resolve(process.cwd(), "traces");
const DEFAULT_WORKSPACE = path.resolve(process.cwd());

function resolveCodexExecutablePath(): string {
  if (process.env["CODEX_CLI_PATH"]) {
    return process.env["CODEX_CLI_PATH"];
  }

  const desktopPath = "/Applications/Codex.app/Contents/Resources/codex";
  if (fs.existsSync(desktopPath)) {
    return desktopPath;
  }

  return "codex";
}

function resolveIpcSocketPath(): string {
  if (process.env["CODEX_IPC_SOCKET"]) {
    return process.env["CODEX_IPC_SOCKET"];
  }

  if (process.platform === "win32") {
    return "\\\\.\\pipe\\codex-ipc";
  }

  const codexHome = process.env["CODEX_HOME"] ?? path.join(os.homedir(), ".codex");
  return path.join(codexHome, "ipc", "ipc.sock");
}

function resolveGitCommitHash(): string | null {
  try {
    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: DEFAULT_WORKSPACE,
      encoding: "utf8"
    }).trim();
    return hash.length > 0 ? hash : null;
  } catch {
    return null;
  }
}

type ResponseHeaders = Record<string, string | number>;

function jsonResponse(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: ResponseHeaders = {}
): void {
  const encoded = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(statusCode, {
    ...API_SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": encoded.length,
    ...headers
  });
  res.end(encoded);
}

function conditionalJsonResponse(
  req: http.IncomingMessage,
  res: ServerResponse,
  body: unknown
): void {
  const response = createConditionalJsonResponse(body, req.headers["if-none-match"]);
  res.writeHead(response.statusCode, {
    ...API_SECURITY_HEADERS,
    ...response.headers
  });
  res.end(response.body ?? undefined);
}

function eventResponse(res: ServerResponse, body: object, eventName?: string): void {
  writeSseEvent(res, encodeSseEvent(body, eventName));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function normalizeStderrLine(line: string): string {
  return line.replace(ANSI_ESCAPE_REGEX, "").trim();
}

function isKnownBenignAppServerStderr(line: string): boolean {
  const normalized = normalizeStderrLine(line);
  return (
    normalized.includes("codex_core::rollout::list") &&
    normalized.includes("state db missing rollout path for thread")
  );
}

interface HistoryEntry {
  id: string;
  at: string;
  source: "ipc" | "app" | "system";
  direction: "in" | "out" | "system";
  payload: unknown;
  meta: Record<string, unknown>;
}

interface TraceSummary {
  id: string;
  label: string;
  startedAt: string;
  stoppedAt: string | null;
  eventCount: number;
  path: string;
}

interface ActiveTrace {
  summary: TraceSummary;
  stream: fs.WriteStream;
}

const history = new ByteBoundedBuffer<HistoryEntry>(HISTORY_LIMIT, 16 * 1024 * 1024);

const threadOwnerById = new Map<string, string>();
const appServerOwnedThreadIds = new Set<string>();
const unmaterializedThreadSettingsById = new Map<string, AppServerStartThreadResponse>();
const streamEvents = new ByteBoundedBuffer<{ threadId: string; frame: IpcFrame }>(
  2_000, 16 * 1024 * 1024
);
let streamEventSequence = 0;
const threadStreamStateAccumulator = new ThreadStreamStateAccumulator();
const threadStreamStabilityDiagnostics = new ThreadStreamStabilityDiagnostics({
  windowMs: 30_000,
  warningThreshold: 600,
  now: Date.now,
  onWarning: (snapshot) => {
    logger.warn(snapshot, "thread-stream-stability-window");
  }
});
const appServerFollowUpQueue = new AppServerFollowUpQueue((threadId) => {
  broadcastSse({ type: "queued-follow-ups-changed", threadId });
});
const desktopFollowUpQueue = new DesktopFollowUpQueue();
const rolloutActivityReader = new RolloutActivityReader();
const desktopSidebarStateReader = new DesktopSidebarStateReader();
const imageUploadStore = new ImageUploadStore();
const desktopUsageResets = new DesktopUsageResets();

function toQueuedImage(image: ImageUploadMetadata, sessionKey: string): QueuedImage {
  return {
    id: image.id,
    sessionKey,
    filename: image.filename,
    mediaType: image.mediaType,
    size: image.size,
    path: image.path
  };
}

function toImagePaths(images: readonly ImageUploadMetadata[]): string[] {
  return images.map((image) => image.path);
}

async function consumeQueuedImages(images: readonly QueuedImage[]): Promise<void> {
  const idsBySession = new Map<string, string[]>();
  for (const image of images) {
    const ids = idsBySession.get(image.sessionKey) ?? [];
    ids.push(image.id);
    idsBySession.set(image.sessionKey, ids);
  }
  await Promise.all(
    [...idsBySession.entries()].map(([sessionKey, ids]) =>
      imageUploadStore.consume(sessionKey, ids)
    )
  );
}

async function removeQueuedImages(images: readonly QueuedImage[]): Promise<void> {
  const idsBySession = new Map<string, string[]>();
  for (const image of images) {
    const ids = idsBySession.get(image.sessionKey) ?? [];
    ids.push(image.id);
    idsBySession.set(image.sessionKey, ids);
  }
  await Promise.all(
    [...idsBySession.entries()].map(([sessionKey, ids]) =>
      imageUploadStore.remove(sessionKey, ids)
    )
  );
}

function publicQueuedImage(image: QueuedImage): {
  id: string;
  filename: string;
  mediaType: QueuedImage["mediaType"];
  size: number;
  url: string;
} {
  return {
    id: image.id,
    filename: image.filename,
    mediaType: image.mediaType,
    size: image.size,
    url: `/api/uploads/${image.id}`
  };
}

function serializeAppServerQueue(threadId: string) {
  return appServerFollowUpQueue.list(threadId).map((message) => ({
    id: message.id,
    text: message.text,
    createdAt: message.createdAt,
    ...(message.pausedReason ? { pausedReason: message.pausedReason } : {}),
    images: (message.images ?? []).map(publicQueuedImage)
  }));
}

async function serializeDesktopQueue(threadId: string, sessionKey: string) {
  desktopFollowUpQueue.refreshFromDisk();
  return Promise.all(
    desktopFollowUpQueue.getNativeMessages(threadId).map(async (message) => {
      const images = await Promise.all(
        queuedFollowUpImageIds(message).map(async (id) => {
          try {
            const image = await imageUploadStore.read(sessionKey, id);
            return publicQueuedImage(toQueuedImage(image, sessionKey));
          } catch {
            return null;
          }
        })
      );
      return {
        id: message.id,
        text: message.text,
        createdAt: message.createdAt,
        ...(message.pausedReason ? { pausedReason: message.pausedReason } : {}),
        images: images.filter((image) => image !== null)
      };
    })
  );
}

async function serializeFollowUpQueues(threadId: string, sessionKey: string) {
  const admitted = await runAppServerCall(() => appClient.listQueuedSubmissions(threadId));
  const admittedClientIds = new Set(admitted.map(message => message.clientUserMessageId));
  const desktop = await serializeDesktopQueue(threadId, sessionKey);
  return mergeQueuedFollowUps<Awaited<ReturnType<typeof serializeDesktopQueue>>[number]>(
    admitted.map(message => ({
      id: message.id,
      text: message.input.map(part => {
        switch (part.type) {
          case "text": return part.text;
          case "image": case "localImage": return "[Image attachment]";
          case "audio": case "localAudio": return "[Audio attachment]";
          case "skill": case "mention": return part.name;
        }
      }).join("\n"),
      // The queue API provides order but no timestamp. Preserve that order before local drafts.
      createdAt: 0,
      images: []
    })),
    desktop.filter(message => !admittedClientIds.has(message.id)),
    serializeAppServerQueue(threadId)
  );
}

const sseClients = new Set<ServerResponse>();

let activeTrace: ActiveTrace | null = null;
const recentTraces: TraceSummary[] = [];

const runtimeState = {
  appExecutable: resolveCodexExecutablePath(),
  socketPath: resolveIpcSocketPath(),
  gitCommit: resolveGitCommitHash(),
  host: HOST,
  port: PORT,
  requiresAuth: authConfig.requiresAuth,
  appReady: false,
  ipcConnected: false,
  ipcInitialized: false,
  lastError: null as string | null
};

let bootstrapInFlight: Promise<void> | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let appServerQueueTimer: NodeJS.Timeout | null = null;
let imageCleanupTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

function getRuntimeStateSnapshot(): Record<string, unknown> {
  return {
    ...runtimeState,
    historyCount: history.length,
    historyBytes: history.retainedBytes,
    streamEventBytes: streamEvents.retainedBytes,
    threadOwnerCount: threadOwnerById.size,
    activeTrace: activeTrace?.summary ?? null
  };
}

function recordTraceEvent(event: unknown): void {
  if (!activeTrace) {
    return;
  }

  activeTrace.summary.eventCount += 1;
  activeTrace.stream.write(`${JSON.stringify(event)}\n`);
}

function broadcastSse(payload: object): void {
  const encoded = encodeSseEvent(payload);
  for (const client of sseClients) {
    if (!writeSseEvent(client, encoded)) sseClients.delete(client);
  }
}

function broadcastNamedSse(eventName: string, payload: object): void {
  const encoded = encodeSseEvent(payload, eventName);
  for (const client of sseClients) {
    if (!writeSseEvent(client, encoded)) sseClients.delete(client);
  }
}

function pushHistory(
  source: HistoryEntry["source"],
  direction: HistoryEntry["direction"],
  payload: unknown,
  meta: Record<string, unknown> = {}
): HistoryEntry {
  const entry: HistoryEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source,
    direction,
    payload,
    meta
  };

  history.push(entry, Buffer.byteLength(JSON.stringify(entry)));

  recordTraceEvent({ type: "history", ...entry });
  // Debug clients fetch history explicitly; regular clients need only an invalidation.
  broadcastSse({ type: "history", entry: null });
  return entry;
}

function pushSystem(message: string, details: Record<string, unknown> = {}): void {
  logger.info({ message, ...details }, "system-event");
  pushHistory("system", "system", { message, details });
}

type ActionStage = "attempt" | "success" | "error";

function summarizeActionDetails(details: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const keys = [
    "threadId",
    "ownerClientId",
    "requestId",
    "textLength",
    "isSteering",
    "durationMs",
    "cwd",
    "model",
    "transport",
    "fallbackFromDesktop"
  ];

  for (const key of keys) {
    const value = details[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }

  const modeValue = details["collaborationMode"];
  if (modeValue && typeof modeValue === "object") {
    const modeRecord = modeValue as Record<string, unknown>;
    const maybeMode = modeRecord["mode"];
    if (typeof maybeMode === "string") {
      summary["mode"] = maybeMode;
    }

    const settings = modeRecord["settings"];
    if (settings && typeof settings === "object") {
      const settingsRecord = settings as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(settingsRecord, "model")) {
        summary["model"] = settingsRecord["model"];
      }
      if (Object.prototype.hasOwnProperty.call(settingsRecord, "reasoning_effort")) {
        summary["reasoningEffort"] = settingsRecord["reasoning_effort"];
      }
    }
  }

  return summary;
}

function pushActionEvent(
  action: string,
  stage: ActionStage,
  details: Record<string, unknown>
): void {
  logger.info(
    {
      action,
      stage,
      ...summarizeActionDetails(details)
    },
    "action-event"
  );
  pushHistory("app", "out", {
    type: "action",
    action,
    stage,
    ...details
  });
}

function pushActionError(
  action: string,
  error: unknown,
  details: Record<string, unknown>
): string {
  const message = toErrorMessage(error);
  logger.error(
    {
      action,
      error: message,
      ...summarizeActionDetails(details)
    },
    "action-error"
  );
  pushActionEvent(action, "error", { ...details, error: message });
  pushSystem("Action failed", { action, ...details, error: message });
  return message;
}

function broadcastRuntimeState(): void {
  broadcastSse({
    type: "state",
    state: getRuntimeStateSnapshot()
  });
}

function setRuntimeError(error: unknown): string {
  const message = toErrorMessage(error);
  runtimeState.lastError = message;
  return message;
}

function setAppReady(next: boolean): void {
  if (runtimeState.appReady === next) {
    return;
  }
  runtimeState.appReady = next;
  broadcastRuntimeState();
}

function isThreadNotLoadedError(error: unknown): boolean {
  if (!(error instanceof AppServerRpcError)) {
    return false;
  }

  if (error.code !== -32600) {
    return false;
  }

  return error.message.includes("thread not loaded");
}

async function runAppServerCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    setAppReady(true);
    return result;
  } catch (error) {
    if (error instanceof AppServerTransportError) {
      setAppReady(false);
    } else {
      setAppReady(true);
    }
    throw error;
  }
}

function requireIpcReady(res: ServerResponse): boolean {
  if (runtimeState.ipcConnected && runtimeState.ipcInitialized) {
    return true;
  }

  jsonResponse(res, 503, {
    ok: false,
    error: runtimeState.lastError ?? "Desktop IPC is not connected"
  });
  return false;
}

function requiresAuthForPath(pathname: string): boolean {
  if (!authConfig.requiresAuth) {
    return false;
  }

  if (pathname === "/events") {
    return true;
  }

  if (!pathname.startsWith("/api/")) {
    return false;
  }

  return !isPublicApiPath(pathname);
}

function respondAuthError(
  res: ServerResponse,
  code: AuthErrorCode | "DEBUG_DISABLED_REMOTE",
  message: string,
  clearCookie: boolean
): void {
  const statusCode = code === "DEBUG_DISABLED_REMOTE" ? 403 : 401;
  const body = AuthErrorBodySchema.parse({
    ok: false,
    error: message,
    code
  });

  jsonResponse(
    res,
    statusCode,
    body,
    clearCookie ? { "Set-Cookie": authService.getClearCookieHeader() } : {}
  );
}

function isDebugRoute(pathname: string): boolean {
  return pathname.startsWith("/api/debug");
}

function scheduleIpcReconnect(): void {
  if (shuttingDown) return;
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void bootstrapConnections();
  }, IPC_RECONNECT_DELAY_MS);
}

const appClient = new AppServerClient({
  executablePath: runtimeState.appExecutable,
  userAgent: USER_AGENT,
  cwd: DEFAULT_WORKSPACE,
  onStderr: (line) => {
    const normalized = normalizeStderrLine(line);
    if (isKnownBenignAppServerStderr(normalized)) {
      logger.debug({ line: normalized }, "app-server-stderr-ignored");
      return;
    }

    logger.error({ line: normalized }, "app-server-stderr");
    pushHistory("app", "system", {
      type: "stderr",
      line: normalized
    });
  }
});

const stopAppServerQueueChangedListener = appClient.onQueueChanged(threadId => {
  broadcastSse({ type: "queued-follow-ups-changed", threadId });
});

const stopAppServerTurnCompletedListener = appClient.onTurnCompleted(({ threadId }) => {
  void appServerFollowUpQueue
    .releaseIfIdle({
      threadId,
      isOwned: () => appServerOwnedThreadIds.has(threadId),
      release: async () => {
        const result = await runAppServerCall(() => appClient.unsubscribeThread(threadId));
        appServerOwnedThreadIds.delete(threadId);
        unmaterializedThreadSettingsById.delete(threadId);
        logger.info(
          { threadId, unsubscribeStatus: result.status },
          "app-server-task-ownership-released"
        );
        broadcastSse({ type: "queued-follow-ups-changed", threadId });
      }
    })
    .catch((error) => {
      logger.warn(
        { threadId, error: toErrorMessage(error) },
        "app-server-task-ownership-release-failed"
      );
    });
});

async function isAppServerQueueThreadActive(threadId: string): Promise<boolean> {
  if (rolloutActivityReader.readThread(threadId) === "active") {
    return true;
  }

  return (await runAppServerCall(() => appClient.getActiveTurnId(threadId))) !== null;
}

async function hasAppServerActiveTurn(threadId: string): Promise<boolean> {
  try {
    return (await runAppServerCall(() => appClient.getActiveTurnId(threadId))) !== null;
  } catch (error) {
    if (isThreadNotLoadedError(error)) {
      return false;
    }
    throw error;
  }
}

const ipcClient = new DesktopIpcClient({
  socketPath: runtimeState.socketPath
});

const service = new CodexMonitorService(ipcClient);
const ownerDiscovery = new OwnerDiscoveryCoordinator(
  (threadId) => service.discoverThreadOwner(threadId),
  threadOwnerById
);
function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  if (value === "1" || value === "true") {
    return true;
  }

  if (value === "0" || value === "false") {
    return false;
  }

  return fallback;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

function enrichThreadSidebar(result: AppServerListThreadsResponse): AppServerListThreadsResponse & {
  data: Array<AppServerListThreadsResponse["data"][number] & {
    sidebar: {
      isPinned: boolean;
      isProjectPinned: boolean;
      isProjectless: boolean;
      projectPath: string | null;
      projectName: string | null;
      projectOrder: number | null;
      hasUnreadTurn: boolean;
    };
  }>;
} {
  const state = desktopSidebarStateReader.read();
  if (state.error) {
    logger.warn(
      { filePath: state.filePath, error: state.error },
      "desktop-sidebar-state-unavailable"
    );
  }

  return {
    ...result,
    data: result.data.map((thread) => {
      return {
        ...thread,
        sidebar: resolveThreadSidebarMetadata(state, thread)
      };
    })
  };
}

async function resolveTargetedOwnerClientId(
  threadId: string,
  override?: string
): Promise<string> {
  const mapped = threadOwnerById.get(threadId)?.trim();
  if (mapped) {
    return mapped;
  }

  const explicit = override?.trim();
  if (explicit) {
    return explicit;
  }

  return ownerDiscovery.discover(threadId);
}

async function resolveMessageDeliveryWithDiscovery(
  threadId: string,
  intent: "queue" | "steer",
  override?: string
): Promise<ReturnType<typeof resolveMessageDelivery>> {
  const delivery = resolveMessageDelivery(
    threadOwnerById,
    appServerOwnedThreadIds,
    threadId,
    rolloutActivityReader.readThread(threadId) === "active",
    intent,
    override
  );
  if (delivery.type !== "desktop-discovery") {
    return delivery;
  }
  return {
    type: "desktop",
    ownerClientId: await ownerDiscovery.discover(threadId)
  };
}

async function resolveSideMessageDeliveryWithDiscovery(
  threadId: string,
  override?: string
): Promise<ReturnType<typeof resolveSideMessageDelivery>> {
  if (appServerOwnedThreadIds.has(threadId)) {
    return { type: "app-server" };
  }
  const mapped = threadOwnerById.get(threadId)?.trim() || override?.trim();
  if (mapped) {
    return { type: "desktop", ownerClientId: mapped };
  }
  return {
    type: "desktop",
    ownerClientId: await ownerDiscovery.discover(threadId)
  };
}

function createTurnStartTemplate(
  threadId: string,
  requestedCwd: string | undefined,
  resume: AppServerResumeThreadResponse
): TurnStartParams {
  const cwd = normalizeOptionalString(requestedCwd) ?? normalizeOptionalString(resume.cwd);
  const model = normalizeOptionalString(resume.model);
  const effort = normalizeOptionalString(resume.reasoningEffort);
  const approvalPolicy = normalizeOptionalString(resume.approvalPolicy);

  return TurnStartParamsSchema.parse({
    threadId,
    input: [],
    ...(cwd ? { cwd } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(resume.sandbox ? { sandboxPolicy: resume.sandbox } : {}),
    summary: "auto",
    attachments: []
  });
}

async function submitDesktopMessage(input: {
  threadId: string;
  text: string;
  cwd?: string;
  isSteering: boolean;
  images: readonly ImageUploadMetadata[];
}): Promise<{ ownerClientId: string; queued: boolean }> {
  const submission = resolveDesktopComposerSubmission({
    isActive: rolloutActivityReader.readThread(input.threadId) === "active",
    isSteering: input.isSteering,
    imageCount: input.images.length
  });
  if (submission === "native-composer") {
    const acknowledgement = await service.typeAndSubmitDesktopMessage({
      threadId: input.threadId,
      text: input.text
    });
    return { ownerClientId: acknowledgement.ownerClientId, queued: false };
  }

  const cachedOwnerClientId = threadOwnerById.get(input.threadId)?.trim();
  const ownerClientId = await resolveDesktopComposerOwner({
    submission,
    cachedOwnerClientId,
    discoverOwner: () => ownerDiscovery.discover(input.threadId)
  });
  const desktopImages = input.images.map((image) => ({
    id: image.id,
    path: image.path,
    filename: image.filename
  }));

  if (!desktopComposerSubmissionNeedsResume(submission)) {
    const cwd = normalizeOptionalString(input.cwd) ?? DEFAULT_WORKSPACE;
    const acknowledgement = await service.appendDesktopFollowUp({
      threadId: input.threadId,
      ...(ownerClientId ? { ownerClientId } : {}),
      text: input.text,
      cwd,
      images: desktopImages
    });
    ownerDiscovery.remember(input.threadId, acknowledgement.ownerClientId);
    desktopFollowUpQueue.update(input.threadId, acknowledgement.messages);
    broadcastSse({ type: "queued-follow-ups-changed", threadId: input.threadId });
    return { ownerClientId: acknowledgement.ownerClientId, queued: true };
  }

  if (!ownerClientId) {
    throw new Error(`Desktop owner is required for direct task input ${input.threadId}`);
  }
  const resume = await runAppServerCall(() => appClient.resumeThreadMetadata(input.threadId));
  const cwd = normalizeOptionalString(input.cwd) ?? normalizeOptionalString(resume.cwd) ?? DEFAULT_WORKSPACE;
  const turnStartTemplate = createTurnStartTemplate(input.threadId, cwd, resume);
  if (input.isSteering) {
    const restoreMessage = service.createDesktopFollowUpMessage({
      text: input.text,
      cwd,
      images: desktopImages
    });
    await service.sendMessage({
      threadId: input.threadId,
      ownerClientId,
      text: input.text,
      imagePaths: toImagePaths(input.images),
      isSteering: true,
      restoreMessage,
      turnStartTemplate
    });
  } else {
    await service.sendMessage({
      threadId: input.threadId,
      ownerClientId,
      text: input.text,
      imagePaths: toImagePaths(input.images),
      turnStartTemplate
    });
  }
  return { ownerClientId, queued: false };
}

function summarizeFrameForLog(frame: IpcFrame): Record<string, string | number | null> {
  if (frame.type === "request") {
    return {
      frameType: frame.type,
      method: frame.method,
      requestId: frame.requestId,
      sourceClientId: frame.sourceClientId ?? null
    };
  }

  if (frame.type === "broadcast") {
    return {
      frameType: frame.type,
      method: frame.method,
      sourceClientId: frame.sourceClientId ?? null
    };
  }

  if (frame.type === "response") {
    return {
      frameType: frame.type,
      method: frame.method ?? null,
      requestId: frame.requestId,
      handledByClientId: frame.handledByClientId ?? null
    };
  }

  if (frame.type === "client-discovery-request") {
    return {
      frameType: frame.type,
      requestId: frame.requestId,
      method: frame.request.method
    };
  }

  return {
    frameType: frame.type,
    requestId: frame.requestId,
    canHandle: frame.response.canHandle ? "true" : "false"
  };
}

function getThreadLiveState(threadId: string): {
  ownerClientId: string | null;
  conversationState: ThreadConversationState | null;
} {
  const state = threadStreamStateAccumulator.get(threadId);

  return {
    ownerClientId: state?.ownerClientId ?? threadOwnerById.get(threadId) ?? null,
    conversationState: state?.conversationState
      ? projectLiveConversationState(state.conversationState)
      : null
  };
}

function extractThreadId(frame: IpcFrame): string | null {
  if (frame.type === "broadcast" && frame.method === "thread-stream-state-changed") {
    const params = frame.params;
    if (!params || typeof params !== "object") {
      return null;
    }

    const conversationId = (params as Record<string, unknown>)["conversationId"];
    if (typeof conversationId === "string" && conversationId.trim()) {
      return conversationId.trim();
    }

    return null;
  }

  if (frame.type !== "request") {
    return null;
  }

  const params = frame.params;
  if (!params || typeof params !== "object") {
    return null;
  }

  const asRecord = params as Record<string, unknown>;
  const candidates = [
    asRecord["conversationId"],
    asRecord["threadId"],
    asRecord["turnId"]
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function sendIpcRequest(
  method: string,
  params: unknown,
  options: SendRequestOptions = {}
): Promise<unknown> {
  const payload = {
    type: "request",
    method,
    params,
    targetClientId: options.targetClientId ?? null,
    version: options.version ?? null
  };

  pushHistory("ipc", "out", payload, {
    method,
    threadId: extractThreadId({
      type: "request",
      requestId: "monitor-preview-request-id",
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version
    })
  });

  const response = await ipcClient.sendRequestAndWait(method, params, options);
  return response;
}

function sendIpcBroadcast(
  method: string,
  params: IpcBroadcastFrame["params"],
  options: SendBroadcastOptions = {}
): void {
  const payload = {
    type: "broadcast",
    method,
    params,
    targetClientIds: options.targetClientIds ?? null,
    version: options.version ?? null
  };

  pushHistory("ipc", "out", payload, {
    method,
    threadId: extractThreadId({
      type: "request",
      requestId: "monitor-preview-request-id",
      method,
      params,
      version: options.version
    })
  });

  ipcClient.sendBroadcast(method, params, options);
}

ipcClient.onConnectionState((state) => {
  runtimeState.ipcConnected = state.connected;
  if (!state.connected) {
    runtimeState.ipcInitialized = false;
    ownerDiscovery.clear();
    const clearedThreadCount = threadStreamStateAccumulator.clear();
    streamEvents.clear();
    streamEventSequence = 0;
    pushSystem("IPC stream cache reset", {
      clearedThreadCount,
      reason: state.reason ?? "connection closed"
    });
    scheduleIpcReconnect();
  } else if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (state.reason) {
    runtimeState.lastError = state.reason;
    pushSystem("IPC connection state changed", {
      connected: state.connected,
      reason: state.reason
    });
  }

  broadcastRuntimeState();
});

ipcClient.onFrame((frame) => {
  const threadId = extractThreadId(frame);
  logger.debug(
    {
      frameType: frame.type,
      method: frame.type === "request" || frame.type === "broadcast" ? frame.method : "response",
      threadId
    },
    "ipc-frame"
  );

  pushHistory("ipc", "in", frame, {
    method: frame.type === "request" || frame.type === "broadcast" ? frame.method : "response",
    threadId
  });

  if (frame.type === "broadcast" && frame.method === "thread-queued-followups-changed") {
    try {
      const queueChange = parseThreadQueuedFollowUpsChangedBroadcast(frame);
      const previousMessages = desktopFollowUpQueue.getNativeMessages(
        queueChange.params.conversationId
      );
      const nextMessageIds = new Set(
        queueChange.params.messages.map((message) => message.id)
      );
      const removedImageIds = previousMessages
        .filter((message) => !nextMessageIds.has(message.id))
        .flatMap(queuedFollowUpImageIds);
      desktopFollowUpQueue.update(
        queueChange.params.conversationId,
        queueChange.params.messages
      );
      if (removedImageIds.length > 0) {
        void imageUploadStore.consumeInternal(removedImageIds).catch((error) => {
          logger.warn(
            { error: toErrorMessage(error), threadId: queueChange.params.conversationId },
            "desktop-queue-image-consume-failed"
          );
        });
      }
      broadcastSse({
        type: "queued-follow-ups-changed",
        threadId: queueChange.params.conversationId
      });
    } catch (error) {
      logger.error(
        { error: toErrorMessage(error), ...summarizeFrameForLog(frame) },
        "invalid-queued-follow-ups-event"
      );
    }
  }

  if (frame.type === "broadcast" && frame.method === "thread-composer-draft-changed") {
    try {
      const draftChange = parseThreadComposerDraftChangedBroadcast(frame);
      const draftThreadId = draftChange.params.conversationId;
      applyDesktopOwnershipEvidence(
        threadOwnerById,
        appServerOwnedThreadIds,
        draftThreadId,
        draftChange.sourceClientId,
        "composer-draft"
      );
    } catch (error) {
      logger.error(
        { error: toErrorMessage(error), ...summarizeFrameForLog(frame) },
        "invalid-composer-draft-event"
      );
    }
  }

  if (frame.type === "broadcast" && frame.method === "thread-stream-state-changed") {
    let streamEvent: ReturnType<typeof parseThreadStreamStateChangedBroadcast>;
    try {
      streamEvent = parseThreadStreamStateChangedBroadcast(frame);
    } catch (error) {
      if (threadStreamStabilityDiagnostics.recordInvalidEvent(threadId)) {
        logger.warn(
          {
            threadId,
            error: toErrorMessage(error),
            ...summarizeFrameForLog(frame),
            ...(LOG_RAW_PROTOCOL_ERRORS ? { rawPayload: frame } : {})
          },
          "invalid-thread-stream-event"
        );
      }
      return;
    }

    const conversationId = streamEvent.params.conversationId;
    threadStreamStabilityDiagnostics.recordEvent(conversationId);

    if (streamEvent.sourceClientId.trim()) {
      applyDesktopOwnershipEvidence(
        threadOwnerById,
        appServerOwnedThreadIds,
        conversationId,
        streamEvent.sourceClientId,
        "thread-stream"
      );
    }

    streamEvents.push({ threadId: conversationId, frame }, Buffer.byteLength(JSON.stringify(frame)));
    const eventIndex = streamEventSequence++;

    try {
      threadStreamStateAccumulator.ingest(streamEvent, eventIndex);
      if (threadStreamStateAccumulator.isQuarantined(conversationId)) {
        return;
      }
      broadcastNamedSse("thread-live-state-changed", {
        type: "thread-live-state-changed",
        threadId: conversationId
      });
    } catch (error) {
      const shouldLogReductionDetail =
        threadStreamStabilityDiagnostics.recordReductionFailure(conversationId);
      const reductionContext =
        error instanceof ThreadStreamReductionError
          ? {
              threadId: error.details.threadId,
              eventIndex: error.details.eventIndex,
              patchIndex: error.details.patchIndex,
              ...(LOG_RAW_PROTOCOL_ERRORS
                ? {
                    rawEvent: error.details.event,
                    rawPatch: error.details.patch
                  }
                : {})
            }
          : null;
      if (shouldLogReductionDetail) {
        logger.error(
          {
            threadId: conversationId,
            eventCount: eventIndex + 1,
            error: toErrorMessage(error),
            reductionContext
          },
          "thread-stream-reduction-failed"
        );
        pushSystem("Thread stream quarantined until the next snapshot", {
          threadId: conversationId,
          eventCount: eventIndex + 1,
          error: toErrorMessage(error),
          reductionContext
        });
      }
    }
  }
});

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      jsonResponse(res, 400, { ok: false, error: "Missing request URL" });
      return;
    }

    if (req.method === "OPTIONS") {
      jsonResponse(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const pathname = url.pathname;
    if (SERVE_WEB && pathname !== "/api" && !pathname.startsWith("/api/") && pathname !== "/events") {
      await serveStaticWeb(WEB_ROOT, req, res);
      return;
    }
    const segments = pathname.split("/").filter(Boolean);
    const networkInfo = getRequestNetworkInfo(req, { directWeb: SERVE_WEB });
    const remoteRequest = networkInfo.isRemote;
    const debugAvailable = !remoteRequest || authConfig.remoteDebugEnabled;
    let requestSessionKey: string | null = authConfig.requiresAuth ? null : "local";

    if (req.method === "GET" && pathname === "/api/auth/session") {
      const session = authService.getSessionState(req.headers.cookie);
      const response = AuthSessionResponseSchema.parse({
        ok: true,
        authenticated: session.authenticated,
        expiresAt: session.expiresAt,
        requiresAuth: authConfig.requiresAuth,
        remoteRequest,
        debugAvailable,
        fullControlAvailable: true
      });
      jsonResponse(res, 200, response);
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = parseBody(LoginBodySchema, await readLimitedJsonBody(req));
      const loginResult = authService.login(body.pin, networkInfo.remoteAddress ?? "unknown");
      if (!loginResult.ok) {
        respondAuthError(res, "AUTH_INVALID", loginResult.error ?? "PIN is incorrect.", true);
        return;
      }

      const response = LoginResponseSchema.parse({
        ok: true,
        expiresAt: loginResult.expiresAt
      });
      jsonResponse(
        res,
        200,
        response,
        loginResult.setCookie ? { "Set-Cookie": loginResult.setCookie } : {}
      );
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      const clearCookie = authService.logout(req.headers.cookie);
      const response = LogoutResponseSchema.parse({ ok: true });
      jsonResponse(res, 200, response, { "Set-Cookie": clearCookie });
      return;
    }

    if (requiresAuthForPath(pathname)) {
      const requirement = authService.requireSession(req.headers.cookie);
      if (!requirement.ok) {
        respondAuthError(
          res,
          requirement.code ?? "AUTH_REQUIRED",
          requirement.error ?? "Authentication is required.",
          requirement.clearCookie
        );
        return;
      }
      if (requirement.setCookie) {
        res.setHeader("Set-Cookie", requirement.setCookie);
      }
      requestSessionKey = requirement.sessionKey;
    }

    if (isDebugRoute(pathname) && !debugAvailable) {
      respondAuthError(
        res,
        "DEBUG_DISABLED_REMOTE",
        "Debug endpoints are disabled for remote sessions.",
        false
      );
      return;
    }

    if (req.method === "POST" && pathname === "/api/client-errors") {
      const body = parseBody(ClientErrorBodySchema, await readLimitedJsonBody(req));
      logger.error(
        {
          kind: body.kind,
          message: body.message,
          stack: body.stack ?? null,
          url: body.url,
          userAgent: body.userAgent,
          timestamp: body.timestamp,
          details: body.details
        },
        "frontend-client-error"
      );
      jsonResponse(res, 202, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/uploads") {
      if (!requestSessionKey) {
        jsonResponse(res, 401, { ok: false, error: "Authentication is required." });
        return;
      }
      try {
        const image = await parseMultipartImageUpload(
          req.headers,
          req,
          imageUploadStore,
          requestSessionKey
        );
        jsonResponse(
          res,
          200,
          ImageUploadResponseSchema.parse({
            ok: true,
            image: {
              id: image.id,
              filename: image.filename,
              mediaType: image.mediaType,
              size: image.size,
              url: `/api/uploads/${image.id}`
            }
          })
        );
      } catch (error) {
        const message = toErrorMessage(error);
        jsonResponse(res, /size limit/iu.test(message) ? 413 : 400, {
          ok: false,
          error: message
        });
      }
      return;
    }

    if (segments[1] === "uploads" && segments[2]) {
      if (!requestSessionKey) {
        jsonResponse(res, 401, { ok: false, error: "Authentication is required." });
        return;
      }
      const uploadId = decodeURIComponent(segments[2]);
      if (req.method === "GET" && segments.length === 3) {
        try {
          const image = await imageUploadStore.read(requestSessionKey, uploadId);
          const body = await fs.promises.readFile(image.path);
          res.writeHead(200, {
            ...API_SECURITY_HEADERS,
            "Content-Type": image.mediaType,
            "Content-Length": body.length
          });
          res.end(body);
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: toErrorMessage(error) });
        }
        return;
      }
      if (req.method === "DELETE" && segments.length === 3) {
        try {
          await imageUploadStore.remove(requestSessionKey, [uploadId]);
          jsonResponse(res, 200, { ok: true });
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: toErrorMessage(error) });
        }
        return;
      }
    }

    if (req.method === "GET" && pathname === "/api/health") {
      const response = HealthResponseSchema.parse({
        ok: true,
        state: {
          appReady: runtimeState.appReady,
          ipcConnected: runtimeState.ipcConnected,
          ipcInitialized: runtimeState.ipcInitialized,
          requiresAuth: authConfig.requiresAuth,
          multiAccount: multiAccountEnabled
        }
      });
      conditionalJsonResponse(req, res, response);
      return;
    }

    if (req.method === "GET" && pathname === "/api/remote/status") {
      const status = getRemoteStatusSnapshot(HOST, PORT);
      const response = RemoteStatusResponseSchema.parse({
        ok: true,
        tailscaleInstalled: status.tailscaleInstalled,
        tailscaleIps: status.tailscaleIps,
        host: status.host,
        port: status.port
      });
      jsonResponse(res, 200, response);
      return;
    }

    if (req.method === "GET" && pathname === "/api/device/status") {
      const response = DeviceStatusResponseSchema.parse({
        ok: true,
        status: await readDeviceStatus()
      });
      jsonResponse(res, 200, response);
      return;
    }

    if (req.method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });

      registerSseClient(sseClients, res);
      eventResponse(res, {
        type: "state",
        state: getRuntimeStateSnapshot()
      });

      return;
    }

    if (req.method === "POST" && pathname === "/api/threads") {
      const body = parseBody(StartThreadBodySchema, await readLimitedJsonBody(req));

      pushActionEvent("thread-create", "attempt", {
        cwd: body.cwd ?? DEFAULT_WORKSPACE,
        model: body.model ?? null,
        modelProvider: body.modelProvider ?? null
      });

      let result;
      try {
        result = await runAppServerCall(() =>
          appClient.startThread({
            cwd: body.cwd ?? DEFAULT_WORKSPACE,
            ...(body.model ? { model: body.model } : {}),
            ...(body.modelProvider ? { modelProvider: body.modelProvider } : {}),
            ...(body.personality ? { personality: body.personality } : {}),
            ...(body.sandbox ? { sandbox: body.sandbox } : {}),
            ...(body.approvalPolicy ? { approvalPolicy: body.approvalPolicy } : {}),
            ...(typeof body.ephemeral === "boolean" ? { ephemeral: body.ephemeral } : {})
          })
        );
      } catch (error) {
        const message = pushActionError("thread-create", error, {
          cwd: body.cwd ?? DEFAULT_WORKSPACE
        });
        jsonResponse(res, 500, { ok: false, error: message });
        return;
      }

      pushActionEvent("thread-create", "success", {
        threadId: result.thread.id,
        cwd: result.cwd ?? result.thread.cwd ?? null,
        model: result.model ?? null
      });
      appServerOwnedThreadIds.add(result.thread.id);
      unmaterializedThreadSettingsById.set(result.thread.id, result);

      jsonResponse(res, 200, {
        ok: true,
        ...result,
        threadId: result.thread.id
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/threads") {
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 80, 200, "limit");
      const archived = parseBoolean(url.searchParams.get("archived"), false);
      const all = parseBoolean(url.searchParams.get("all"), false);
      const maxPages = parseBoundedInteger(
        url.searchParams.get("maxPages"),
        20,
        50,
        "maxPages"
      );
      const cursor = url.searchParams.get("cursor") ?? null;

      const result = await runAppServerCall(() =>
        all
          ? appClient.listThreadsAll(
              cursor
                ? {
                    limit,
                    archived,
                    cursor,
                    maxPages
                  }
                : {
                    limit,
                    archived,
                    maxPages
                  }
            )
          : appClient.listThreads(
            cursor
              ? {
                  limit,
                  archived,
                  cursor
                }
              : {
                  limit,
                  archived
                }
          )
      );

      conditionalJsonResponse(req, res, {
        ok: true,
        ...enrichThreadSidebar(enrichThreadActivity(result, rolloutActivityReader))
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/models") {
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 100, 200, "limit");
      const result = await runAppServerCall(() => appClient.listModels(limit));
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "GET" && pathname === "/api/collaboration-modes") {
      const result = await runAppServerCall(() => appClient.listCollaborationModes());
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === "/api/accounts/resets" && req.method === "GET") {
      const threadId = z.string().min(1).parse(url.searchParams.get("threadId"));
      jsonResponse(res, 200, { ok: true, status: await desktopUsageResets.status(threadId) });
      return;
    }
    if (pathname === "/api/accounts/resets" && req.method === "POST") {
      const body = parseBody(ConsumeUsageResetBodySchema, await readLimitedJsonBody(req));
      const result = await desktopUsageResets.consume(body);
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "GET" && pathname === "/api/accounts/status") {
      if (!multiAccountEnabled) {
        jsonResponse(res, 404, { ok: false, error: "Multi-account mode is disabled" });
        return;
      }
      const response = AccountsStatusResponseSchema.parse({
        ok: true,
        ...(await readAccountsStatus())
      });
      jsonResponse(res, 200, response);
      return;
    }

    if (segments[0] === "api" && segments[1] === "threads" && segments[2]) {
      const threadId = decodeURIComponent(segments[2]);

      if (
        req.method === "GET" &&
        segments[3] === "visualization-previews" &&
        segments[4] &&
        segments.length === 5
      ) {
        const filename = decodeURIComponent(segments[4]);
        const previewPath = await resolveThreadVisualizationPreviewPath(threadId, filename);
        if (!previewPath) {
          jsonResponse(res, 404, { ok: false, error: "Visualization preview not found." });
          return;
        }
        const body = await renderVisualizationPreview(previewPath);
        res.writeHead(200, {
          "Cache-Control": "private, max-age=300",
          "Content-Type": "image/png",
          "Content-Length": body.length,
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff"
        });
        res.end(body);
        return;
      }

      if (
        req.method === "GET" &&
        segments[3] === "visualizations" &&
        segments[4] &&
        segments.length === 5
      ) {
        const filename = decodeURIComponent(segments[4]);
        const visualizationPath = await resolveThreadVisualizationPath(threadId, filename);
        if (!visualizationPath) {
          jsonResponse(res, 404, { ok: false, error: "Visualization not found." });
          return;
        }
        const body = await fs.promises.readFile(visualizationPath);
        res.writeHead(200, {
          "Cache-Control": "private, max-age=300",
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": body.length,
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff"
        });
        res.end(body);
        return;
      }

      if (
        req.method === "GET" &&
        segments[3] === "media" &&
        segments[4] &&
        segments[5] &&
        segments.length === 6
      ) {
        const mediaRoute = ThreadMediaRouteSchema.parse({
          threadId,
          itemId: decodeURIComponent(segments[4]),
          imageIndex: segments[5]
        });
        let image;
        try {
          const liveState = threadStreamStateAccumulator.get(threadId)?.conversationState ?? null;
          const reference = await resolveCurrentThreadImage(
            liveState,
            async () => (await runAppServerCall(() => appClient.readThread(threadId, true))).thread,
            mediaRoute.itemId,
            mediaRoute.imageIndex
          );
          image = await materializeThreadImage(reference);
        } catch (error) {
          if (error instanceof ThreadMediaNotFoundError) {
            jsonResponse(res, 404, { ok: false, error: error.message });
            return;
          }
          throw error;
        }
        if (image.type === "redirect") {
          res.writeHead(307, {
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
            Location: image.location
          });
          res.end();
          return;
        }
        res.writeHead(200, {
          "Cache-Control": "private, max-age=300",
          "Content-Type": image.contentType,
          "Content-Length": image.body.length,
          "X-Content-Type-Options": "nosniff"
        });
        res.end(image.body);
        return;
      }

      if (req.method === "GET" && segments[3] === "account-status") {
        if (!multiAccountEnabled) {
          jsonResponse(res, 404, { ok: false, error: "Multi-account mode is disabled" });
          return;
        }
        const response = ThreadAccountStatusResponseSchema.parse({
          ok: true,
          ...readThreadAccountStatus(threadId)
        });
        conditionalJsonResponse(req, res, response);
        return;
      }

      if (req.method === "GET" && segments[3] === "settings") {
        const settings = await runAppServerCall(() =>
          appClient.readThreadSettings(
            threadId,
            unmaterializedThreadSettingsById.get(threadId),
            threadStreamStateAccumulator.get(threadId)?.conversationState ?? undefined
          )
        );
        const response = ThreadSettingsResponseSchema.parse({ ok: true, ...settings });
        conditionalJsonResponse(req, res, response);
        return;
      }

      if (req.method === "POST" && segments[3] === "compact") {
        const body = parseBody(CompactThreadBodySchema, await readLimitedJsonBody(req));
        const delivery = await resolveMessageDeliveryWithDiscovery(
          threadId,
          "steer",
          body.ownerClientId
        );
        await executeCompactThread({ threadId, delivery, service, appClient });
        jsonResponse(res, 200, ThreadActionResponseSchema.parse({ ok: true, threadId }));
        return;
      }

      if (req.method === "POST" && segments[3] === "edit-last-message") {
        const body = parseBody(EditLastMessageBodySchema, await readLimitedJsonBody(req));
        const delivery = await resolveMessageDeliveryWithDiscovery(
          threadId,
          "steer",
          body.ownerClientId
        );
        await executeEditLastMessage({
          threadId,
          turnId: body.turnId,
          message: body.message,
          delivery,
          service,
          appClient
        });
        jsonResponse(res, 200, ThreadActionResponseSchema.parse({ ok: true, threadId }));
        return;
      }

      if (req.method === "POST" && segments[3] === "side") {
        const body = parseBody(SideThreadBodySchema, await readLimitedJsonBody(req));
        const delivery = await resolveSideMessageDeliveryWithDiscovery(
          threadId,
          body.ownerClientId
        );
        const result = await executeSideThread({
          threadId,
          cwd: body.cwd,
          delivery,
          service,
          appClient
        });
        if (delivery.type === "desktop") {
          threadOwnerById.set(result.threadId, delivery.ownerClientId);
        } else {
          appServerOwnedThreadIds.add(result.threadId);
        }
        jsonResponse(
          res,
          200,
          SideThreadResponseSchema.parse({ ok: true, ...result })
        );
        return;
      }

      if (req.method === "POST" && segments[3] === "fork") {
        const body = parseBody(ForkThreadBodySchema, await readLimitedJsonBody(req));
        const forkedThreadId = await executeForkThread({
          threadId,
          turnId: body.turnId,
          appClient
        });
        appServerOwnedThreadIds.add(forkedThreadId);
        jsonResponse(
          res,
          200,
          ThreadActionResponseSchema.parse({ ok: true, threadId: forkedThreadId })
        );
        return;
      }

      if (req.method === "PATCH" && segments[3] === "settings") {
        const body = parseBody(
          UpdateThreadSettingsBodySchema,
          await readLimitedJsonBody(req)
        );
        await runAppServerCall(() =>
          appClient.updateThreadSettings({ threadId, ...body })
        );
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "DELETE" && segments.length === 3) {
        await runAppServerCall(() => appClient.deleteThread(threadId));
        appServerOwnedThreadIds.delete(threadId);
        unmaterializedThreadSettingsById.delete(threadId);
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && segments.length === 3) {
        const includeTurns = parseBoolean(url.searchParams.get("includeTurns"), true);
        let result;
        try {
          result = await runAppServerCall(() => appClient.readThread(threadId, includeTurns));
        } catch (error) {
          if (isThreadNotLoadedError(error)) {
            jsonResponse(res, 404, {
              ok: false,
              error: `Thread not loaded in app-server: ${threadId}`,
              threadId
            });
            return;
          }
          throw error;
        }
        jsonResponse(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === "GET" && segments[3] === "live-state") {
        const live = getThreadLiveState(threadId);
        const queuedFollowUps = await serializeFollowUpQueues(threadId, requestSessionKey ?? "local");
        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId: live.ownerClientId,
          conversationState: live.conversationState,
          queuedFollowUps
        });
        return;
      }

      if (segments[3] === "queue") {
        if (req.method === "GET" && segments.length === 4) {
          jsonResponse(res, 200, QueuedFollowUpsResponseSchema.parse({
            ok: true, threadId, ownerClientId: getThreadLiveState(threadId).ownerClientId,
            messages: await serializeFollowUpQueues(threadId, requestSessionKey ?? "local")
          }));
          return;
        }
        const queuedSubmissionId = segments[4] ? decodeURIComponent(segments[4]) : null;
        const admitted = queuedSubmissionId === null ? null :
          (await runAppServerCall(() => appClient.listQueuedSubmissions(threadId)))
            .find(message => message.id === queuedSubmissionId);
        if (admitted) {
          if (req.method === "PATCH" && segments.length === 5) {
            const body = parseBody(EditQueuedFollowUpBodySchema, await readLimitedJsonBody(req));
            await runAppServerCall(() => appClient.updateQueuedSubmission(threadId, admitted.id, [
              { type: "text", text: body.text, text_elements: [] },
              ...admitted.input.filter(part => part.type !== "text")
            ]));
          } else if (req.method === "DELETE" && segments.length === 5) {
            const deleted = await runAppServerCall(() => appClient.deleteQueuedSubmission(threadId, admitted.id));
            if (!deleted) {
              jsonResponse(res, 404, { ok: false, error: "Queued message was not found", threadId });
              return;
            }
          } else if (req.method === "POST" && segments[5] === "steer") {
            await runAppServerCall(() => appClient.sendQueuedSubmissionNow(threadId, admitted));
          } else {
            jsonResponse(res, 405, { ok: false, error: "Unsupported queued message action", threadId });
            return;
          }
          broadcastSse({ type: "queued-follow-ups-changed", threadId });
          jsonResponse(res, 200, QueuedFollowUpActionResponseSchema.parse({ ok: true, threadId, messageId: admitted.id }));
          return;
        }
        desktopFollowUpQueue.refreshFromDisk();
        let ownerClientId = threadOwnerById.get(threadId) ?? null;
        let ownerDiscoveryError: string | null = null;
        if (
          !ownerClientId &&
          !appServerOwnedThreadIds.has(threadId) &&
          !desktopFollowUpQueue.hasThread(threadId)
        ) {
          try {
            ownerClientId = await ownerDiscovery.discover(threadId);
          } catch (error) {
            ownerDiscoveryError = toErrorMessage(error);
          }
        }
        if (ownerDiscoveryError && rolloutActivityReader.readThread(threadId) === "active") {
          jsonResponse(res, 409, {
            ok: false,
            error: `Desktop owner discovery failed: ${ownerDiscoveryError}`,
            threadId
          });
          return;
        }

        const messageId = segments[4] ? decodeURIComponent(segments[4]) : null;
        if (!messageId) {
          jsonResponse(res, 404, { ok: false, error: "Queued message was not found", threadId });
          return;
        }

        const isDesktopQueue = desktopFollowUpQueue.getNative(threadId, messageId) !== null;

        if (req.method === "PATCH" && segments.length === 5) {
          const body = parseBody(EditQueuedFollowUpBodySchema, await readLimitedJsonBody(req));
          if (isDesktopQueue) {
            const changed = await desktopFollowUpQueue.runExclusive(threadId, async () => {
              const current = desktopFollowUpQueue.getNativeMessages(threadId);
              if (!current.some((message) => message.id === messageId)) return false;
              const messages = current.map((message) =>
                message.id === messageId
                  ? withQueuedFollowUpText(message, body.text)
                  : message
              );
              service.setQueuedFollowUps({
                threadId,
                ...(ownerClientId ? { ownerClientId } : {}),
                messages
              });
              desktopFollowUpQueue.update(threadId, messages);
              return true;
            });
            if (!changed) {
              jsonResponse(res, 404, { ok: false, error: "Queued message was not found", threadId });
              return;
            }
          } else if (!appServerFollowUpQueue.edit(threadId, messageId, body.text)) {
            jsonResponse(res, 404, { ok: false, error: "Queued message was not found", threadId });
            return;
          }
          broadcastSse({ type: "queued-follow-ups-changed", threadId });
          jsonResponse(
            res,
            200,
            QueuedFollowUpActionResponseSchema.parse({ ok: true, threadId, messageId })
          );
          return;
        }

        if (req.method === "DELETE" && segments.length === 5) {
          let removedDesktopImageIds: string[] = [];
          if (isDesktopQueue) {
            const changed = await desktopFollowUpQueue.runExclusive(threadId, async () => {
              const current = desktopFollowUpQueue.getNativeMessages(threadId);
              const removedMessage = current.find((message) => message.id === messageId);
              if (!removedMessage) return false;
              removedDesktopImageIds = queuedFollowUpImageIds(removedMessage);
              const messages = current.filter((message) => message.id !== messageId);
              service.setQueuedFollowUps({
                threadId,
                ...(ownerClientId ? { ownerClientId } : {}),
                messages
              });
              desktopFollowUpQueue.update(threadId, messages);
              return true;
            });
            if (!changed) {
              jsonResponse(res, 404, { ok: false, error: "Queued message was not found", threadId });
              return;
            }
            if (removedDesktopImageIds.length > 0 && requestSessionKey) {
              await imageUploadStore.remove(requestSessionKey, removedDesktopImageIds);
            }
          } else {
            const removed = appServerFollowUpQueue.remove(threadId, messageId);
            if (!removed) {
              jsonResponse(res, 404, { ok: false, error: "Queued message was not found", threadId });
              return;
            }
            await removeQueuedImages(removed.images ?? []);
          }
          broadcastSse({ type: "queued-follow-ups-changed", threadId });
          jsonResponse(
            res,
            200,
            QueuedFollowUpActionResponseSchema.parse({ ok: true, threadId, messageId })
          );
          return;
        }

        if (req.method === "POST" && segments[5] === "steer") {
          if (!requireIpcReady(res)) return;
          if (isDesktopQueue) {
            let resolvedOwnerClientId = ownerClientId;
            if (!resolvedOwnerClientId) {
              try {
                resolvedOwnerClientId = await ownerDiscovery.discover(threadId);
              } catch (error) {
                const message = pushActionError("queue-steer", error, { threadId });
                jsonResponse(res, 409, { ok: false, error: message, threadId });
                return;
              }
            }
            const changed = await desktopFollowUpQueue.runExclusive(threadId, async () => {
              const message = desktopFollowUpQueue.getNative(threadId, messageId);
              if (!message) return false;
              const resume = await runAppServerCall(() => appClient.resumeThreadMetadata(threadId));
              await service.sendMessage({
                threadId,
                ownerClientId: resolvedOwnerClientId,
                text: message.text,
                isSteering: true,
                restoreMessage: message,
                turnStartTemplate: createTurnStartTemplate(threadId, message.cwd, resume)
              });
              const imageIds = queuedFollowUpImageIds(message);
              if (imageIds.length > 0 && requestSessionKey) {
                await imageUploadStore.consume(requestSessionKey, imageIds);
              }
              const messages = desktopFollowUpQueue
                .getNativeMessages(threadId)
                .filter((queuedMessage) => queuedMessage.id !== messageId);
              service.setQueuedFollowUps({
                threadId,
                ownerClientId: resolvedOwnerClientId,
                messages
              });
              desktopFollowUpQueue.update(threadId, messages);
              return true;
            });
            if (!changed) {
              jsonResponse(res, 404, { ok: false, error: "Queued message was not found", threadId });
              return;
            }
          } else {
            const message = appServerFollowUpQueue
              .list(threadId)
              .find((queuedMessage) => queuedMessage.id === messageId);
            if (!message) {
              jsonResponse(res, 404, { ok: false, error: "Queued message was not found", threadId });
              return;
            }
            const queuedImages = message.images ?? [];
            await runAppServerCall(() =>
              appClient.steerUserMessage(
                threadId,
                message.text,
                queuedImages.map((image) => image.path)
              )
            );
            await consumeQueuedImages(queuedImages);
            appServerFollowUpQueue.remove(threadId, messageId);
          }
          broadcastSse({ type: "queued-follow-ups-changed", threadId });
          jsonResponse(
            res,
            200,
            QueuedFollowUpActionResponseSchema.parse({ ok: true, threadId, messageId })
          );
          return;
        }
      }

      if (req.method === "GET" && segments[3] === "stream-events") {
        const limit = parseBoundedInteger(url.searchParams.get("limit"), 60, 1_000, "limit");
        const events = streamEvents.values()
          .filter((event) => event.threadId === threadId)
          .slice(-Math.min(limit, 400))
          .map((event) => event.frame);
        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId: threadOwnerById.get(threadId) ?? null,
          events
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "messages") {
        const body = parseBody(SendMessageBodySchema, await readLimitedJsonBody(req));
        if (!requestSessionKey) {
          jsonResponse(res, 401, { ok: false, error: "Authentication is required." });
          return;
        }
        let resolvedImages: ImageUploadMetadata[];
        try {
          resolvedImages = await imageUploadStore.resolveReady(
            requestSessionKey,
            body.images
          );
        } catch (error) {
          jsonResponse(res, 400, { ok: false, error: toErrorMessage(error), threadId });
          return;
        }
        const deliveryStartedAtMs = Date.now();
        const delivery = resolveComposerMessageDelivery(
          appServerOwnedThreadIds,
          threadId,
          unmaterializedThreadSettingsById.has(threadId)
        );
        const unavailableReason = composerMessageDeliveryUnavailableReason(
          delivery,
          runtimeState
        );
        if (unavailableReason) {
          jsonResponse(res, 503, {
            ok: false,
            error: unavailableReason,
            threadId
          });
          return;
        }

        pushActionEvent("messages", "attempt", {
          threadId,
          ownerClientId: null,
          transport: delivery.type,
          textLength: body.text.length,
          isSteering: body.isSteering === true,
          ...(body.cwd ? { cwd: body.cwd } : {})
        });

        let acknowledgedOwnerClientId: string | null = null;
        let actualTransport = delivery.type;
        let fallbackFromDesktop = false;
        let imagesQueued = false;

        try {
          const result = await executeComposerMessageDelivery({
            delivery,
            submitDesktop: async () => {
              const acknowledgement = await submitDesktopMessage({
                threadId,
                text: body.text,
                ...(body.cwd ? { cwd: body.cwd } : {}),
                isSteering: body.isSteering === true,
                images: resolvedImages
              });
              imagesQueued = acknowledgement.queued;
              return acknowledgement;
            },
            sendAppServer: async (isDesktopFallback) => {
              const imagePaths = toImagePaths(resolvedImages);
              const initialSettings = unmaterializedThreadSettingsById.get(threadId);
              if (initialSettings) {
                await runAppServerCall(() =>
                  appClient.sendInitialUserMessage(initialSettings, body.text, imagePaths)
                );
                unmaterializedThreadSettingsById.delete(threadId);
                return null;
              }
              if (body.isSteering === true) {
                await runAppServerCall(() =>
                  appClient.steerUserMessage(threadId, body.text, imagePaths)
                );
                return null;
              }
              const queueResult = await appServerFollowUpQueue.enqueueOrSend({
                threadId,
                text: body.text,
                images: resolvedImages.map((image) =>
                  toQueuedImage(image, requestSessionKey)
                ),
                isActive: async () => isAppServerQueueThreadActive(threadId),
                isOwned: () =>
                  isDesktopFallback || appServerOwnedThreadIds.has(threadId),
                send: async () =>
                  runAppServerCall(() =>
                    appClient.sendUserMessage(threadId, body.text, imagePaths)
                  )
              });
              imagesQueued = queueResult === "queued";
              if (queueResult === "owner-changed") {
                if (resolvedImages.length > 0) {
                  const acknowledgement = await submitDesktopMessage({
                    threadId,
                    text: body.text,
                    ...(body.cwd ? { cwd: body.cwd } : {}),
                    isSteering: false,
                    images: resolvedImages
                  });
                  imagesQueued = acknowledgement.queued;
                  return acknowledgement;
                }
                return submitDesktopMessage({
                  threadId,
                  text: body.text,
                  ...(body.cwd ? { cwd: body.cwd } : {}),
                  isSteering: false,
                  images: []
                });
              }
              return null;
            }
          });

          actualTransport = result.transport;
          fallbackFromDesktop = result.fallbackFromDesktop;
          acknowledgedOwnerClientId = result.ownerClientId;
          if (result.transport === "desktop-takeover" && result.ownerClientId) {
            appServerOwnedThreadIds.delete(threadId);
            unmaterializedThreadSettingsById.delete(threadId);
            threadOwnerById.set(threadId, result.ownerClientId);
          } else {
            appServerOwnedThreadIds.add(threadId);
          }

          if (resolvedImages.length > 0 && !imagesQueued) {
            await imageUploadStore.consume(requestSessionKey, body.images);
          }
        } catch (error) {
          const message = pushActionError("messages", error, {
            threadId,
            ownerClientId: acknowledgedOwnerClientId
          });
          jsonResponse(res, delivery.type === "desktop-takeover" ? 503 : 500, {
            ok: false,
            error: message,
            threadId,
            ownerClientId: acknowledgedOwnerClientId
          });
          return;
        }

        pushActionEvent("messages", "success", {
          threadId,
          ownerClientId: acknowledgedOwnerClientId,
          transport: actualTransport,
          fallbackFromDesktop,
          durationMs: Date.now() - deliveryStartedAtMs
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId: acknowledgedOwnerClientId
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "collaboration-mode") {
        if (!requireIpcReady(res)) {
          return;
        }

        const body = parseBody(SetModeBodySchema, await readLimitedJsonBody(req));
        let ownerClientId: string;
        try {
          ownerClientId = await resolveTargetedOwnerClientId(threadId, body.ownerClientId);
        } catch (error) {
          const message = pushActionError("collaboration-mode", error, { threadId });
          jsonResponse(res, 409, { ok: false, error: message, threadId });
          return;
        }

        pushActionEvent("collaboration-mode", "attempt", {
          threadId,
          ownerClientId,
          collaborationMode: body.collaborationMode
        });

        try {
          await service.setCollaborationMode({
            threadId,
            ownerClientId,
            collaborationMode: body.collaborationMode as CollaborationMode
          });
        } catch (error) {
          const message = pushActionError("collaboration-mode", error, {
            threadId,
            ownerClientId,
            collaborationMode: body.collaborationMode
          });
          jsonResponse(res, 500, { ok: false, error: message, threadId, ownerClientId });
          return;
        }

        pushActionEvent("collaboration-mode", "success", {
          threadId,
          ownerClientId,
          collaborationMode: body.collaborationMode
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "user-input") {
        if (!requireIpcReady(res)) {
          return;
        }

        const body = parseBody(SubmitUserInputBodySchema, await readLimitedJsonBody(req));
        let ownerClientId: string;
        try {
          ownerClientId = await resolveTargetedOwnerClientId(threadId, body.ownerClientId);
        } catch (error) {
          const message = pushActionError("user-input", error, { threadId, requestId: body.requestId });
          jsonResponse(res, 409, { ok: false, error: message, threadId, requestId: body.requestId });
          return;
        }

        pushActionEvent("user-input", "attempt", {
          threadId,
          ownerClientId,
          requestId: body.requestId
        });

        try {
          await service.submitUserInput({
            threadId,
            ownerClientId,
            requestId: body.requestId,
            response: parseUserInputResponsePayload(body.response)
          });
        } catch (error) {
          const message = pushActionError("user-input", error, {
            threadId,
            ownerClientId,
            requestId: body.requestId
          });
          jsonResponse(res, 500, {
            ok: false,
            error: message,
            threadId,
            ownerClientId,
            requestId: body.requestId
          });
          return;
        }

        pushActionEvent("user-input", "success", {
          threadId,
          ownerClientId,
          requestId: body.requestId
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId,
          requestId: body.requestId
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "interrupt") {
        const body = parseBody(InterruptBodySchema, await readLimitedJsonBody(req));
        let delivery: ReturnType<typeof resolveInterruptDelivery>;
        try {
          const hasKnownDesktopOwner = Boolean(
            threadOwnerById.get(threadId)?.trim() || body.ownerClientId?.trim()
          );
          const appServerActive = hasKnownDesktopOwner
            ? false
            : await hasAppServerActiveTurn(threadId);
          delivery = resolveInterruptDelivery(
            threadOwnerById,
            threadId,
            appServerActive,
            rolloutActivityReader.readThread(threadId) === "active",
            body.ownerClientId
          );
        } catch (error) {
          const message = pushActionError("interrupt", error, { threadId });
          jsonResponse(res, 409, { ok: false, error: message, threadId });
          return;
        }

        const unavailableReason = interruptDeliveryUnavailableReason(delivery, runtimeState);
        if (unavailableReason) {
          jsonResponse(res, 503, {
            ok: false,
            error: unavailableReason,
            threadId
          });
          return;
        }

        pushActionEvent("interrupt", "attempt", {
          threadId,
          ownerClientId: delivery.type === "desktop" ? delivery.ownerClientId : null,
          transport: delivery.type
        });

        try {
          if (delivery.type === "desktop") {
            await service.interrupt({ threadId, ownerClientId: delivery.ownerClientId });
          } else if (delivery.type === "desktop-discovery") {
            await service.interrupt({ threadId });
          } else {
            await runAppServerCall(() => appClient.interruptTurn(threadId));
          }
        } catch (error) {
          const message = pushActionError("interrupt", error, {
            threadId,
            ownerClientId: delivery.type === "desktop" ? delivery.ownerClientId : null
          });
          jsonResponse(res, 500, {
            ok: false,
            error: message,
            threadId,
            ownerClientId: delivery.type === "desktop" ? delivery.ownerClientId : null
          });
          return;
        }

        pushActionEvent("interrupt", "success", {
          threadId,
          ownerClientId: delivery.type === "desktop" ? delivery.ownerClientId : null,
          transport: delivery.type
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId: delivery.type === "desktop" ? delivery.ownerClientId : null
        });
        return;
      }
    }

    if (segments[0] === "api" && segments[1] === "debug") {
      if (req.method === "GET" && segments[2] === "history" && !segments[3]) {
        const limit = parseBoundedInteger(url.searchParams.get("limit"), 120, 500, "limit");
        const data = history.values().slice(-limit);
        jsonResponse(res, 200, { ok: true, history: data });
        return;
      }

      if (req.method === "GET" && segments[2] === "history" && segments[3]) {
        const entryId = decodeURIComponent(segments[3]);
        const entry = history.values().find((item) => item.id === entryId) ?? null;
        if (!entry) {
          jsonResponse(res, 404, { ok: false, error: "History entry not found" });
          return;
        }

        jsonResponse(res, 200, {
          ok: true,
          entry,
          fullPayload: entry.payload
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/replay") {
        if (!requireIpcReady(res)) {
          return;
        }

        const body = parseBody(ReplayBodySchema, await readLimitedJsonBody(req));
        const entry = history.values().find((item) => item.id === body.entryId);
        if (!entry) {
          jsonResponse(res, 404, { ok: false, error: "History entry not found" });
          return;
        }

        const payload = entry.payload;
        if (!payload || typeof payload !== "object") {
          jsonResponse(res, 409, { ok: false, error: "Entry payload is unavailable" });
          return;
        }

        const record = payload as Record<string, unknown>;
        const type = record["type"];

        if (type === "request") {
          const method = record["method"];
          if (typeof method !== "string") {
            jsonResponse(res, 409, { ok: false, error: "Captured request has invalid method" });
            return;
          }

          const options: SendRequestOptions = {};
          if (typeof record["targetClientId"] === "string") {
            options.targetClientId = record["targetClientId"];
          }
          if (typeof record["version"] === "number") {
            options.version = record["version"];
          }

          const sendPromise = sendIpcRequest(method, record["params"], options);

          if (body.waitForResponse) {
            const response = await sendPromise;
            jsonResponse(res, 200, { ok: true, replayed: true, response });
            return;
          }

          void sendPromise.catch((error) => {
            pushSystem("Replay request failed", { error: toErrorMessage(error), entryId: entry.id });
          });

          jsonResponse(res, 200, {
            ok: true,
            replayed: true,
            queued: true
          });
          return;
        }

        if (type === "broadcast") {
          const broadcast = IpcBroadcastFrameSchema.parse(record);
          sendIpcBroadcast(broadcast.method, broadcast.params, {
            ...(broadcast.targetClientIds
              ? { targetClientIds: broadcast.targetClientIds }
              : {}),
            ...(broadcast.version === undefined ? {} : { version: broadcast.version })
          });

          jsonResponse(res, 200, { ok: true, replayed: true });
          return;
        }

        jsonResponse(res, 409, {
          ok: false,
          error: "Only captured request and broadcast entries can be replayed"
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/debug/trace/status") {
        jsonResponse(res, 200, {
          ok: true,
          active: activeTrace?.summary ?? null,
          recent: recentTraces
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/trace/start") {
        const body = parseBody(TraceStartBodySchema, await readLimitedJsonBody(req));
        if (activeTrace) {
          jsonResponse(res, 409, {
            ok: false,
            error: "A trace is already active"
          });
          return;
        }

        ensurePrivateDirectory(TRACE_DIR);
        const id = `${Date.now()}-${randomUUID()}`;
        const tracePath = path.join(TRACE_DIR, `${id}.ndjson`);
        const stream = createPrivateAppendStream(tracePath);

        const summary: TraceSummary = {
          id,
          label: body.label,
          startedAt: new Date().toISOString(),
          stoppedAt: null,
          eventCount: 0,
          path: tracePath
        };

        activeTrace = {
          summary,
          stream
        };

        pushSystem("Trace started", {
          traceId: id,
          label: body.label
        });

        jsonResponse(res, 200, {
          ok: true,
          trace: summary
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/trace/mark") {
        const body = parseBody(TraceMarkBodySchema, await readLimitedJsonBody(req));
        if (!activeTrace) {
          jsonResponse(res, 409, { ok: false, error: "No active trace" });
          return;
        }

        const marker = {
          type: "trace-marker",
          at: new Date().toISOString(),
          note: body.note
        };

        activeTrace.stream.write(`${JSON.stringify(marker)}\n`);
        activeTrace.summary.eventCount += 1;

        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/trace/stop") {
        if (!activeTrace) {
          jsonResponse(res, 409, { ok: false, error: "No active trace" });
          return;
        }

        const trace = activeTrace;
        activeTrace = null;

        trace.summary.stoppedAt = new Date().toISOString();
        trace.stream.end();

        recentTraces.unshift(trace.summary);
        if (recentTraces.length > 20) {
          recentTraces.splice(20);
        }

        pushSystem("Trace stopped", { traceId: trace.summary.id });

        jsonResponse(res, 200, {
          ok: true,
          trace: trace.summary
        });
        return;
      }

      if (
        req.method === "GET" &&
        segments[2] === "trace" &&
        segments[3] &&
        segments[4] === "download"
      ) {
        const traceId = decodeURIComponent(segments[3]);
        const trace = recentTraces.find((item) => item.id === traceId);

        if (!trace || !fs.existsSync(trace.path)) {
          jsonResponse(res, 404, { ok: false, error: "Trace not found" });
          return;
        }

        const data = fs.readFileSync(trace.path);
        res.writeHead(200, {
          ...TRACE_SECURITY_HEADERS,
          "Content-Type": "application/x-ndjson",
          "Content-Length": data.length,
          "Content-Disposition": `attachment; filename="${trace.id}.ndjson"`
        });
        res.end(data);
        return;
      }
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    runtimeState.lastError = toErrorMessage(error);
    logger.error(
      {
        method: req.method ?? "unknown",
        url: req.url ?? "unknown",
        error: runtimeState.lastError
      },
      "request-failed"
    );
    pushSystem("Request failed", {
      error: runtimeState.lastError,
      method: req.method ?? "unknown",
      url: req.url ?? "unknown"
    });
    broadcastRuntimeState();
    if (error instanceof HttpRequestError) {
      jsonResponse(res, error.statusCode, {
        ok: false,
        error: error.message
      });
      return;
    }
    jsonResponse(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
});

async function bootstrapConnections(): Promise<void> {
  if (shuttingDown) return;
  if (bootstrapInFlight) {
    return bootstrapInFlight;
  }

  bootstrapInFlight = (async () => {
    try {
      await runAppServerCall(() => appClient.listThreads({ limit: 1, archived: false }));
    } catch (error) {
      const errorMessage = setRuntimeError(error);
      pushSystem("App-server bootstrap failed", { error: errorMessage });
    }

    try {
      if (shuttingDown) return;
      if (!ipcClient.isConnected()) {
        await ipcClient.connect();
      }
      runtimeState.ipcConnected = true;

      const initializeResponse = await ipcClient.initialize(USER_AGENT);
      runtimeState.ipcInitialized = true;

      const initializeResult = initializeResponse.result;
      if (initializeResult && typeof initializeResult === "object") {
        const candidate = (initializeResult as Record<string, unknown>)["clientId"];
        if (typeof candidate === "string" && candidate.trim()) {
          pushSystem("IPC initialized", { clientId: candidate });
        }
      }

    } catch (error) {
      runtimeState.ipcInitialized = false;
      if (!ipcClient.isConnected()) {
        runtimeState.ipcConnected = false;
      }

      const errorMessage = setRuntimeError(error);
      pushSystem("IPC bootstrap failed", { error: errorMessage });
    } finally {
      broadcastRuntimeState();
      bootstrapInFlight = null;
    }
  })();

  return bootstrapInFlight;
}

async function start(): Promise<void> {
  if (SERVE_WEB) fs.accessSync(path.join(WEB_ROOT, "index.html"), fs.constants.R_OK);
  ensurePrivateDirectory(TRACE_DIR);
  await imageUploadStore.cleanupExpired();

  pushSystem("Starting Codex monitor server", {
    appExecutable: runtimeState.appExecutable,
    socketPath: runtimeState.socketPath
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };

    server.once("error", onError);
    server.listen(PORT, HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });

  pushSystem("Monitor server ready", {
    url: `http://${HOST}:${PORT}`,
    appExecutable: runtimeState.appExecutable,
    socketPath: runtimeState.socketPath
  });
  broadcastRuntimeState();
  logger.info({ url: `http://${HOST}:${PORT}` }, "monitor-server-ready");

  appServerQueueTimer = setInterval(() => {
    void appServerFollowUpQueue
      .flushReady({
        isActive: isAppServerQueueThreadActive,
        isOwned: (threadId) => appServerOwnedThreadIds.has(threadId),
        send: async (threadId, text, images = []) => {
          await runAppServerCall(() =>
            appClient.sendUserMessage(
              threadId,
              text,
              images.map((image) => image.path)
            )
          );
          await consumeQueuedImages(images);
        }
      })
      .then(async () => {
        for (const threadId of appServerFollowUpQueue.threadIds()) {
          if (appServerOwnedThreadIds.has(threadId)) continue;
          const ownerClientId = threadOwnerById.get(threadId);
          if (!ownerClientId) continue;
          await appServerFollowUpQueue.handoffThread(threadId, async (text, images = []) => {
            await desktopFollowUpQueue.runExclusive(threadId, async () => {
              const resume = await runAppServerCall(() => appClient.resumeThreadMetadata(threadId));
              const cwd = normalizeOptionalString(resume.cwd) ?? DEFAULT_WORKSPACE;
              const acknowledgement = await service.appendDesktopFollowUp({
                threadId,
                ownerClientId,
                text,
                cwd,
                images: images.map((image) => ({
                  id: image.id,
                  path: image.path,
                  filename: image.filename
                }))
              });
              desktopFollowUpQueue.update(threadId, acknowledgement.messages);
            });
            broadcastSse({ type: "queued-follow-ups-changed", threadId });
          });
        }
      })
      .catch((error) => {
        logger.warn({ error: toErrorMessage(error) }, "app-server-follow-up-queue-flush-failed");
      });
  }, 750);

  imageCleanupTimer = setInterval(() => {
    void imageUploadStore.cleanupExpired().catch((error) => {
      logger.warn({ error: toErrorMessage(error) }, "image-upload-cleanup-failed");
    });
  }, 60 * 60 * 1000);

  void bootstrapConnections();
}

async function shutdown(): Promise<void> {
  shuttingDown = true;
  const serverClosed = closeHttpServer(server, sseClients);
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  sseClients.clear();
  if (appServerQueueTimer) {
    clearInterval(appServerQueueTimer);
    appServerQueueTimer = null;
  }
  if (imageCleanupTimer) {
    clearInterval(imageCleanupTimer);
    imageCleanupTimer = null;
  }
  if (activeTrace) {
    activeTrace.stream.end();
    activeTrace = null;
  }

  stopAppServerTurnCompletedListener();
  stopAppServerQueueChangedListener();
  await ipcClient.disconnect();
  await appClient.close();

  await serverClosed;
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

void start().catch((error) => {
  const errorMessage = setRuntimeError(error);
  pushSystem("Monitor server failed to start", { error: errorMessage });
  logger.fatal({ error: errorMessage }, "monitor-server-failed-to-start");
  process.exit(1);
});
