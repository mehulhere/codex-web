import { CliRequests } from "@/components/CliRequests";
import { replyToCliRequest } from "@/lib/api";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Activity,
  ArrowDown,
  Bug,
  Check,
  Circle,
  CircleDot,
  Folder,
  FolderOpen,
  GitBranch,
  MoreVertical,
  Github,
  Loader2,
  Menu,
  Moon,
  PanelLeft,
  Plus,
  RefreshCcw,
  Settings,
  Sun,
  Trash2,
  Users,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ApiRequestError,
  compactThread,
  createSideThread,
  createThread,
  deleteThread,
  deleteQueuedFollowUp,
  editQueuedFollowUp,
  editLastMessage,
  forkThreadFromTurn,
  getAccountsStatus,
  getAuthSession,
  getHealth,
  getHistoryEntry,
  getLiveState,
  getQueuedFollowUps,
  getPendingUserInputRequests,
  getRemoteStatus,
  getThreadAccountStatus,
  getThreadSettings,
  getStreamEvents,
  readThread,
  getTraceStatus,
  interruptThread,
  loginWithPin,
  listCollaborationModes,
  listModels,
  listDebugHistory,
  listThreads,
  logout,
  markTrace,
  replayHistoryEntry,
  sendMessage,
  startTrace,
  steerQueuedFollowUp,
  stopTrace,
  submitUserInput,
  updateThreadSettings,
  type AccountsStatus,
  type ThreadSettings,
  type ThreadAccountStatus
} from "@/lib/api";
import { useTheme } from "@/hooks/useTheme";
import { useDeviceStatusMonitor } from "@/hooks/useDeviceStatusMonitor";
import {
  getConversationStateUpdatedAt,
  mergeConversationStates
} from "@/lib/conversationState";
import { ConversationItem } from "@/components/ConversationItem";
import { ChatComposer } from "@/components/ChatComposer";
import type { ComposerCommand } from "@/components/SlashCommandMenu";
import { AccountQuotaStrip } from "@/components/AccountQuotaStrip";
import { AccountsPanel } from "@/components/AccountsPanel";
import { readLastThreadId, writeLastThreadId } from "@/last-thread-storage";
import {
  readConnectionAutoRetry,
  writeConnectionAutoRetry
} from "@/connection-retry-storage";
import { ConnectionUnavailable } from "@/components/ConnectionUnavailable";
import { CompactDialog, type CompactDialogState } from "@/components/CompactDialog";
import { StatusDialog } from "@/components/StatusDialog";
import { SideTaskDrawer } from "@/components/SideTaskDrawer";
import { FollowUpQueue } from "@/components/FollowUpQueue";
import { FileChangeSummary } from "@/components/FileChangeSummary";
import { EnvironmentPanel } from "@/components/EnvironmentPanel";
import { CpuTemperatureStatus } from "@/components/CpuTemperatureStatus";
import { PendingRequestCard } from "@/components/PendingRequestCard";
import { StreamEventCard } from "@/components/StreamEventCard";
import { ReasoningActivityGroup } from "@/components/ReasoningActivityGroup";
import { TaskHeader } from "@/components/TaskHeader";
import { summarizeFileChanges } from "@/lib/fileChangeSummary";
import { buildEnvironmentSummary } from "@/lib/environmentSummary";
import {
  activeThinkingCue,
  isReasoningActivityItem,
  latestReasoningIndex,
  reasoningActivityItems,
  reasoningActivityOwnerIndex,
  reasoningActivitySummary,
  reasoningActivitySummaryFromItems
} from "@/lib/reasoningActivitySummary";
import { WorkingSummary } from "@/components/WorkingSummary";
import {
  normalizeReasoningEffort,
  reasoningEffortOptions,
  ReasoningEffortSelect
} from "@/components/ReasoningEffortSelect";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  getCoreRefreshIntervalMs,
  getThreadListRefreshIntervalMs,
  getThreadRefreshIntervalMs,
  getThreadRefreshMode
} from "@/thread-refresh";
import { buildSidebarModel, type SidebarProjectGroup } from "@/sidebar-model";
import { CoalescedTask } from "@/coalesced-task";
import {
  clearPersistedComposerDrafts
} from "@/local-composer-drafts";
import { reportClientError } from "@/lib/client-error-logger";
import { parseGenericSseEvent, parseThreadLiveStateChangedEvent } from "@/sse-events";
import {
  readDisplayPreferences,
  type DisplayPreferences
} from "@/display-preferences";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

/* ── Types ─────────────────────────────────────────────────── */
type Health = Awaited<ReturnType<typeof getHealth>>;
type ThreadsResponse = Awaited<ReturnType<typeof listThreads>>;
type ModesResponse = Awaited<ReturnType<typeof listCollaborationModes>>;
type ModelsResponse = Awaited<ReturnType<typeof listModels>>;
type LiveStateResponse = Awaited<ReturnType<typeof getLiveState>>;
type StreamEventsResponse = Awaited<ReturnType<typeof getStreamEvents>>;
type ReadThreadResponse = Awaited<ReturnType<typeof readThread>>;
type TraceStatus = Awaited<ReturnType<typeof getTraceStatus>>;
type HistoryResponse = Awaited<ReturnType<typeof listDebugHistory>>;
type HistoryDetail = Awaited<ReturnType<typeof getHistoryEntry>>;
type AuthSession = Awaited<ReturnType<typeof getAuthSession>>;
type RemoteStatus = Awaited<ReturnType<typeof getRemoteStatus>>;
type PendingRequest = ReturnType<typeof getPendingUserInputRequests>[number];
type Thread = ThreadsResponse["data"][number];
type LiveConnectionState = "connecting" | "connected" | "reconnecting";
type PendingResponseState = {
  threadId: string;
  baselineUpdatedAt: number;
  baselineItemCount: number;
};
type AcknowledgedMessage = {
  id: string;
  threadId: string;
  text: string;
  imageCount: number;
  baselineItemCount: number;
};
type SideTaskState = {
  threadId: string;
  title: string;
};

/* ── Helpers ────────────────────────────────────────────────── */
function formatDate(value: number | string | null | undefined): string {
  if (typeof value === "number") return new Date(value * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return value;
  }
  return "";
}

function AcknowledgedUserMessage({ message }: { message: AcknowledgedMessage }): React.JSX.Element {
  return (
    <div className="flex justify-end" data-testid="acknowledged-user-message">
      <div className="max-w-[80%]">
        <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-foreground leading-relaxed">
          {message.text.trim() && (
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          )}
          {message.imageCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {message.imageCount} {message.imageCount === 1 ? "image" : "images"} attached
            </p>
          )}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
          <Check size={12} aria-hidden="true" />
          <span>Received</span>
        </div>
      </div>
    </div>
  );
}

function epochMilliseconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function threadLabel(thread: Thread): string {
  const name = thread.name?.trim();
  if (name) return name;
  const preview = thread.preview.trim();
  if (preview) return preview;
  return `thread ${thread.id.slice(0, 8)}`;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAuthError(err: unknown): boolean {
  if (!(err instanceof ApiRequestError)) {
    return false;
  }
  return (
    err.code === "AUTH_REQUIRED" ||
    err.code === "AUTH_INVALID" ||
    err.code === "AUTH_EXPIRED"
  );
}

function isDebugDisabledError(err: unknown): boolean {
  return err instanceof ApiRequestError && err.code === "DEBUG_DISABLED_REMOTE";
}

const INITIAL_VISIBLE_CHAT_ITEMS = 180;
const VISIBLE_CHAT_ITEMS_STEP = 120;
const APP_DEFAULT_VALUE = "__app_default__";
const SIDEBAR_PROJECT_PREVIEW_LIMIT = 5;
const SIDEBAR_COLLAPSED_GROUPS_STORAGE_KEY = "farfield.sidebar.collapsed-groups.v1";
const DISPLAY_PREFERENCES_STORAGE_KEY = "farfield.display-preferences.v1";

function isPlanModeOption(mode: { mode: string; name: string }): boolean {
  return mode.mode.toLowerCase().includes("plan") || mode.name.toLowerCase().includes("plan");
}

function buildModeSignature(modeKey: string, modelId: string, effort: string): string {
  return `${modeKey}|${modelId}|${effort}`;
}

function normalizeNullableModeValue(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "";
}

function readModeSelectionFromConversationState(
  state: NonNullable<ReadThreadResponse["thread"]> | null,
  settings: ThreadSettings | null
): {
  modeKey: string;
  modelId: string;
  reasoningEffort: string;
} {
  if (!state) {
    return {
      modeKey: "",
      modelId: settings?.model ?? "",
      reasoningEffort: normalizeReasoningEffort(settings?.reasoningEffort)
    };
  }

  if (state.latestCollaborationMode) {
    return {
      modeKey: state.latestCollaborationMode.mode,
      modelId: settings?.model ?? normalizeNullableModeValue(state.latestCollaborationMode.settings.model),
      reasoningEffort: normalizeReasoningEffort(
        settings?.reasoningEffort ??
        normalizeNullableModeValue(state.latestCollaborationMode.settings.reasoning_effort)
      )
    };
  }

  return {
    modeKey: "",
    modelId: settings?.model ?? normalizeNullableModeValue(state.latestModel),
    reasoningEffort: normalizeReasoningEffort(
      settings?.reasoningEffort ?? normalizeNullableModeValue(state.latestReasoningEffort)
    )
  };
}

function readSidebarCollapsedGroupsFromStorage(): Record<string, boolean> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const storage = window.localStorage as Partial<Storage> | undefined;
    if (!storage || typeof storage.getItem !== "function") {
      return {};
    }
    const raw = storage.getItem(SIDEBAR_COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const collapsed: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") {
        collapsed[key] = value;
      }
    }
    return collapsed;
  } catch {
    return {};
  }
}

function writeSidebarCollapsedGroupsToStorage(value: Record<string, boolean>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const storage = window.localStorage as Partial<Storage> | undefined;
    if (!storage || typeof storage.setItem !== "function") {
      return;
    }
    storage.setItem(SIDEBAR_COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage errors.
  }
}

function parseUiStateFromPath(pathname: string): { threadId: string | null; tab: "chat" | "debug" } {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { threadId: null, tab: "chat" };
  }
  if (segments.length === 1 && segments[0] === "debug") {
    return { threadId: null, tab: "debug" };
  }
  if (segments[0] === "threads" && typeof segments[1] === "string" && segments[1].length > 0) {
    const threadId = decodeURIComponent(segments[1]);
    if (segments[2] === "debug") {
      return { threadId, tab: "debug" };
    }
    return { threadId, tab: "chat" };
  }
  return { threadId: null, tab: "chat" };
}

function buildPathFromUiState(threadId: string | null, tab: "chat" | "debug"): string {
  if (!threadId) {
    return tab === "debug" ? "/debug" : "/";
  }
  if (tab === "debug") {
    return `/threads/${encodeURIComponent(threadId)}/debug`;
  }
  return `/threads/${encodeURIComponent(threadId)}`;
}

function IconBtn({
  onClick,
  disabled,
  title,
  active,
  children
}: {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const buttonNode = (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      variant="ghost"
      size="icon"
      className={`h-8 w-8 rounded-lg ${
        active
          ? "bg-muted text-foreground hover:bg-muted"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </Button>
  );

  if (!title) {
    return buttonNode;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{buttonNode}</TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

/* ── Main App ───────────────────────────────────────────────── */
export function App(): React.JSX.Element {
  const { theme, toggle: toggleTheme } = useTheme();
  const initialUiState = useMemo(() => {
    const pathState = parseUiStateFromPath(window.location.pathname);
    if (pathState.threadId || pathState.tab === "debug") {
      return pathState;
    }
    return {
      ...pathState,
      threadId: readLastThreadId(window.localStorage)
    };
  }, []);

  /* State */
  const [error, setError] = useState("");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [connectionAutoRetryEnabled, setConnectionAutoRetryEnabled] = useState(() =>
    readConnectionAutoRetry(window.localStorage)
  );
  const [connectionRetrying, setConnectionRetrying] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const cliOnly = health?.state.cliOnly === true;
  const multiAccountEnabled = health?.state.multiAccount === true;
  const [threads, setThreads] = useState<ThreadsResponse["data"]>([]);
  const [threadListLoaded, setThreadListLoaded] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialUiState.threadId);
  const [liveState, setLiveState] = useState<LiveStateResponse | null>(null);
  const [threadQueue, setThreadQueue] = useState<Awaited<ReturnType<typeof getQueuedFollowUps>> | null>(null);
  const [composerDraft, setComposerDraft] = useState("");
  const [readThreadState, setReadThreadState] = useState<ReadThreadResponse | null>(null);
  const [streamEvents, setStreamEvents] = useState<StreamEventsResponse["events"]>([]);
  const [accountStatus, setAccountStatus] = useState<ThreadAccountStatus | null>(null);
  const [threadSettings, setThreadSettings] = useState<ThreadSettings | null>(null);
  const [accountsStatus, setAccountsStatus] = useState<AccountsStatus | null>(null);
  const [accountsPanelOpen, setAccountsPanelOpen] = useState(false);
  const [environmentPanelOpen, setEnvironmentPanelOpen] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [compactDialogState, setCompactDialogState] = useState<CompactDialogState | null>(null);
  const [sideTask, setSideTask] = useState<SideTaskState | null>(null);
  const [sideTaskStarting, setSideTaskStarting] = useState(false);
  const [commandNotice, setCommandNotice] = useState("");
  const [modes, setModes] = useState<ModesResponse["data"]>([]);
  const [models, setModels] = useState<ModelsResponse["data"]>([]);
  const [selectedModeKey, setSelectedModeKey] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("low");
  const [isBusy, setIsBusy] = useState(false);
  const [traceStatus, setTraceStatus] = useState<TraceStatus | null>(null);
  const [traceLabel, setTraceLabel] = useState("capture");
  const [traceNote, setTraceNote] = useState("");
  const [history, setHistory] = useState<HistoryResponse["history"]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null);
  const [waitForReplayResponse, setWaitForReplayResponse] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [answerDraft, setAnswerDraft] = useState<Record<string, { option: string; freeform: string }>>({});

  /* UI state */
  const [activeTab, setActiveTab] = useState<"chat" | "debug">(initialUiState.tab);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [sseReconnectAttempt, setSseReconnectAttempt] = useState(0);
  const [liveConnectionState, setLiveConnectionState] = useState<LiveConnectionState>("connecting");
  const [pendingResponseState, setPendingResponseState] = useState<PendingResponseState | null>(null);
  const [acknowledgedMessages, setAcknowledgedMessages] = useState<AcknowledgedMessage[]>([]);
  const [isChatAtBottom, setIsChatAtBottom] = useState(true);
  const [visibleChatItemLimit, setVisibleChatItemLimit] = useState(INITIAL_VISIBLE_CHAT_ITEMS);
  const [suppressEntryAnimations, setSuppressEntryAnimations] = useState(false);
  const [hasHydratedModeFromLiveState, setHasHydratedModeFromLiveState] = useState(false);
  const [isModeSyncing, setIsModeSyncing] = useState(false);
  const [sidebarCollapsedGroups, setSidebarCollapsedGroups] = useState<Record<string, boolean>>(
    () => readSidebarCollapsedGroupsFromStorage()
  );
  const [sidebarExpandedGroups, setSidebarExpandedGroups] = useState<Record<string, boolean>>({});
  const [displayPreferences, setDisplayPreferences] = useState<DisplayPreferences>(() =>
    readDisplayPreferences(window.localStorage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY))
  );

  /* Refs */
  const selectedThreadIdRef = useRef<string | null>(null);
  const liveRequestSequenceRef = useRef(0);
  const queueRequestSequenceRef = useRef(0);
  const connectionRetryInFlightRef = useRef(false);
  const activeTabRef = useRef<"chat" | "debug">(activeTab);
  const sseReconnectTimerRef = useRef<number | null>(null);
  const coreRefreshIntervalRef = useRef<number | null>(null);
  const threadListRefreshIntervalRef = useRef<number | null>(null);
  const selectedThreadPollIntervalRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const lastAppliedModeSignatureRef = useRef("");
  const pendingMaterializationThreadIdsRef = useRef<Set<string>>(new Set());
  const unlistedCreatedThreadIdsRef = useRef<Set<string>>(new Set());
  const durableRefreshInFlightThreadIdsRef = useRef<Set<string>>(new Set());
  const selectedThreadRevisionRef = useRef<{
    threadId: string;
    listRevision: string;
    liveRevision: string;
  } | null>(null);
  const wasGeneratingRef = useRef(false);
  const acknowledgedMessageSequenceRef = useRef(0);

  /* Derived */
  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );
  const selectedThreadIsActive = selectedThread?.status?.type === "active";
  const groupedThreads = useMemo(() => {
    type Group = {
      key: string;
      label: string;
      projectPath: string | null;
      latestUpdatedAt: number;
      threads: Thread[];
      section: "pinned" | "projects" | "tasks";
    };
    const model = buildSidebarModel(threads);
    const toGroup = (
      group: SidebarProjectGroup<Thread>,
      section: "pinned" | "projects"
    ): Group => ({ ...group, section });
    const groups: Group[] = [];
    if (model.pinnedThreads.length > 0) {
      groups.push({
        key: "pinned:threads",
        label: "Pinned chats",
        projectPath: null,
        latestUpdatedAt: model.pinnedThreads[0]?.updatedAt ?? 0,
        threads: model.pinnedThreads,
        section: "pinned"
      });
    }
    groups.push(...model.pinnedProjects.map((group) => toGroup(group, "pinned")));
    groups.push(...model.projects.map((group) => toGroup(group, "projects")));
    groups.push({
      key: "tasks",
      label: "Tasks",
      projectPath: null,
      latestUpdatedAt: model.tasks[0]?.updatedAt ?? 0,
      threads: model.tasks,
      section: "tasks"
    });
    return groups;
  }, [threads]);
  const conversationState = useMemo(() => {
    const liveConversationState =
      liveState?.threadId === selectedThreadId &&
      liveState.conversationState?.id === selectedThreadId
        ? liveState.conversationState
        : null;
    const readConversationState =
      readThreadState?.thread.id === selectedThreadId ? readThreadState.thread : null;
    return mergeConversationStates(liveConversationState, readConversationState);
  }, [liveState?.conversationState, readThreadState?.thread]);
  const environmentSummary = useMemo(
    () =>
      buildEnvironmentSummary({
        branch: selectedThread?.gitInfo?.branch ?? null,
        cwd: selectedThread?.cwd ?? null,
        turns: conversationState?.turns ?? []
      }),
    [conversationState?.turns, selectedThread?.cwd, selectedThread?.gitInfo?.branch]
  );

  const pendingRequests = useMemo(() => {
    if (!conversationState) return [] as PendingRequest[];
    return getPendingUserInputRequests(conversationState);
  }, [conversationState]);

  const activeRequest = useMemo(() => {
    if (!pendingRequests.length) return null;
    if (selectedRequestId === null) return pendingRequests[0];
    return pendingRequests.find((r) => r.id === selectedRequestId) ?? pendingRequests[0];
  }, [pendingRequests, selectedRequestId]);

  const planModeOption = useMemo(
    () => modes.find((mode) => isPlanModeOption(mode)) ?? null,
    [modes]
  );
  const defaultModeOption = useMemo(
    () => modes.find((mode) => !isPlanModeOption(mode)) ?? modes[0] ?? null,
    [modes]
  );
  const isPlanModeEnabled = planModeOption !== null && selectedModeKey === planModeOption.mode;

  const effortOptions = useMemo(() => {
    return reasoningEffortOptions([
      ...modes.map((mode) => mode.reasoning_effort),
      conversationState?.latestReasoningEffort,
      selectedReasoningEffort
    ]);
  }, [conversationState?.latestReasoningEffort, modes, selectedReasoningEffort]);

  const defaultModelId = useMemo(
    () => models.find((model) => model.isDefault)?.id ?? "",
    [models]
  );

  const modelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) {
      const label =
        m.displayName && m.displayName !== m.id
          ? `${m.displayName} (${m.id})`
          : m.displayName || m.id;
      map.set(m.id, label);
    }
    const lm = conversationState?.latestModel;
    if (lm && !map.has(lm)) map.set(lm, lm);
    if (selectedModelId && !map.has(selectedModelId)) map.set(selectedModelId, selectedModelId);
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [conversationState?.latestModel, models, selectedModelId]);
  const modelOptionsWithoutAssumedDefault = useMemo(
    () =>
      modelOptions.filter(
        (option) => option.id !== defaultModelId || option.id === selectedModelId
      ),
    [defaultModelId, modelOptions, selectedModelId]
  );

  const turns = conversationState?.turns ?? [];
  const conversationItemCount = useMemo(
    () => turns.reduce((count, turn) => count + (turn.items?.length ?? 0), 0),
    [turns]
  );
  const selectedAcknowledgedMessages = useMemo(
    () => acknowledgedMessages.filter((message) => message.threadId === selectedThreadId),
    [acknowledgedMessages, selectedThreadId]
  );
  const firstVisibleChatItemIndex = Math.max(0, conversationItemCount - visibleChatItemLimit);
  const hasHiddenChatItems = firstVisibleChatItemIndex > 0;
  const visibleTurns = useMemo(() => {
    let globalItemIndex = 0;
    return turns
      .map((turn, ti) => {
        const items = turn.items ?? [];
        const visibleItems: Array<{ item: (typeof items)[number]; itemIndexInTurn: number; globalItemIndex: number }> = [];
        items.forEach((item, itemIndexInTurn) => {
          const itemGlobalIndex = globalItemIndex;
          globalItemIndex += 1;
          if (itemGlobalIndex >= firstVisibleChatItemIndex) {
            visibleItems.push({ item, itemIndexInTurn, globalItemIndex: itemGlobalIndex });
          }
        });
        return { turn, turnIndex: ti, visibleItems };
      })
      .filter((entry) => entry.visibleItems.length > 0);
  }, [firstVisibleChatItemIndex, turns]);
  const lastTurn = turns[turns.length - 1];
  const isGenerating =
    lastTurn?.status === "in-progress" || lastTurn?.status === "inProgress";
  const latestEditableUserItemId = useMemo(() => {
    if (!lastTurn || isGenerating) {
      return null;
    }
    for (let index = lastTurn.items.length - 1; index >= 0; index -= 1) {
      const item = lastTurn.items[index];
      if (item?.type === "userMessage" || item?.type === "steeringUserMessage") {
        return item.id;
      }
    }
    return null;
  }, [isGenerating, lastTurn]);
  const isWaitingForResponse =
    pendingResponseState !== null &&
    pendingResponseState.threadId === selectedThreadId &&
    !isGenerating;
  const isResponseActive = isGenerating || isWaitingForResponse || selectedThreadIsActive;
  const statusQuotaParts: string[] = [];
  if (accountStatus?.quota5h) {
    statusQuotaParts.push(
      `${String(accountStatus.quota5h.remainingPercent)}% remaining (5h)`
    );
  }
  if (accountStatus?.quota7d) {
    statusQuotaParts.push(
      `${String(accountStatus.quota7d.remainingPercent)}% remaining (7d)`
    );
  }
  const statusQuota = statusQuotaParts.length > 0
    ? statusQuotaParts.join(" · ")
    : "Not reported";
  const allSystemsReady =
    health?.state.appReady === true &&
    (cliOnly || (health?.state.ipcConnected === true && health?.state.ipcInitialized === true));
  const hasAnySystemFailure =
    health?.state.appReady === false ||
    (!cliOnly && (health?.state.ipcConnected === false || health?.state.ipcInitialized === false));
  const systemStatusLabel = allSystemsReady
    ? "Systems ready"
    : hasAnySystemFailure
      ? "Systems unavailable"
      : "Checking systems";
  const allowEntryLayoutAnimations = !suppressEntryAnimations;
  const requiresAuth = authSession?.requiresAuth ?? false;
  const isAuthenticated = authSession?.authenticated ?? false;
  const debugTabAvailable = authSession?.debugAvailable ?? true;
  const isLocked = authSession !== null && requiresAuth && !isAuthenticated;
  const canAccessCore = authSession !== null && (!requiresAuth || isAuthenticated);
  const {
    status: deviceStatus,
    loading: deviceStatusLoading,
    error: deviceStatusError,
    refresh: refreshDeviceStatus
  } = useDeviceStatusMonitor(canAccessCore && (environmentPanelOpen || displayPreferences.monitorCpuTemperature));
  const tailscaleConnectUrls = useMemo(
    () =>
      (remoteStatus?.tailscaleIps ?? []).map(
        (ip) => `http://${ip}:${String(remoteStatus?.port ?? 4312)}`
      ),
    [remoteStatus?.port, remoteStatus?.tailscaleIps]
  );
  const liveConnectionLabel =
    liveConnectionState === "connected"
      ? "Live connected"
      : liveConnectionState === "reconnecting"
        ? "Live reconnecting"
        : "Live connecting";
  const liveConnectionToneClass =
    liveConnectionState === "connected"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";

  /* Data loading */
  const handleRequestError = useCallback((err: unknown) => {
    if (isAuthError(err)) {
      setError("Session requires authentication. Enter your password to continue.");
      setAuthSession((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          authenticated: false,
          expiresAt: null
        };
      });
      setActiveTab("chat");
      setTraceStatus(null);
      setHistory([]);
      return;
    }

    if (isDebugDisabledError(err)) {
      setError("Debug tab is disabled for remote sessions.");
      setActiveTab("chat");
      setTraceStatus(null);
      setHistory([]);
      return;
    }

    reportClientError(err, "request-error", {
      threadId: selectedThreadIdRef.current ?? undefined,
      activeTab: activeTabRef.current
    });
    setError(toErrorMessage(err));
  }, []);

  const handleComposerDraftChange = useCallback((text: string): void => {
    setComposerDraft(text);
  }, []);

  const loadAuthContext = useCallback(async (): Promise<AuthSession> => {
    const session = await getAuthSession();
    setAuthSession(session);
    if (session.requiresAuth && !session.authenticated) {
      setRemoteStatus(null);
      return session;
    }
    void getRemoteStatus().then(setRemoteStatus).catch(handleRequestError);
    return session;
  }, [handleRequestError]);

  const loadThreadList = useCallback(async () => {
    const nt = await listThreads({ limit: 80, archived: false, all: true, maxPages: 20 });
    const listedThreadIds = new Set(nt.data.map((thread) => thread.id));
    for (const threadId of unlistedCreatedThreadIdsRef.current) {
      if (listedThreadIds.has(threadId)) {
        unlistedCreatedThreadIdsRef.current.delete(threadId);
      }
    }
    setThreads((current) => [
      ...nt.data,
      ...current.filter(
        (thread) =>
          unlistedCreatedThreadIdsRef.current.has(thread.id) &&
          !listedThreadIds.has(thread.id)
      )
    ]);
    setSelectedThreadId((cur) => {
      if (
        cur &&
        (listedThreadIds.has(cur) || unlistedCreatedThreadIdsRef.current.has(cur))
      ) {
        return cur;
      }
      return nt.data[0]?.id ?? null;
    });
    setThreadListLoaded(true);
  }, []);

  const loadCoreData = useCallback(async () => {
    void getHealth().then(setHealth).catch(handleRequestError);
    await loadThreadList();
  }, [handleRequestError, loadThreadList]);

  const loadOptionalCoreData = useCallback((session: AuthSession) => {
    void listCollaborationModes()
      .then((nextModes) => {
        setModes(nextModes.data);
        setSelectedModeKey((cur) => {
          if (cur) return cur;
          const nonPlanDefault = nextModes.data.find((mode) => !isPlanModeOption(mode));
          return nonPlanDefault?.mode ?? nextModes.data[0]?.mode ?? "";
        });
      })
      .catch(handleRequestError);
    void listModels().then((nextModels) => setModels(nextModels.data)).catch(handleRequestError);
    if (session.debugAvailable) {
      void getTraceStatus().then(setTraceStatus).catch(handleRequestError);
      void listDebugHistory(120)
        .then((nextHistory) => setHistory(nextHistory.history))
        .catch(handleRequestError);
      return;
    }

    setTraceStatus(null);
    setHistory([]);
    setSelectedHistoryId("");
    setHistoryDetail(null);
    setActiveTab("chat");
  }, [handleRequestError]);

  const loadSelectedThreadDurable = useCallback(async (
    threadId: string,
    includeTurns = !pendingMaterializationThreadIdsRef.current.has(threadId)
  ) => {
    if (durableRefreshInFlightThreadIdsRef.current.has(threadId)) {
      return;
    }
    durableRefreshInFlightThreadIdsRef.current.add(threadId);
    try {
      const read = await readThread(threadId, { includeTurns });
      if (read.thread.turns.length > 0) {
        pendingMaterializationThreadIdsRef.current.delete(threadId);
      }
      if (selectedThreadIdRef.current === threadId) {
        setReadThreadState(read);
      }
    } finally {
      durableRefreshInFlightThreadIdsRef.current.delete(threadId);
    }
  }, []);

  const loadSelectedThreadLive = useCallback(async (threadId: string) => {
    const requestSequence = ++liveRequestSequenceRef.current;
    const live = await getLiveState(threadId);
    if (selectedThreadIdRef.current !== threadId || requestSequence !== liveRequestSequenceRef.current) {
      return;
    }
    setLiveState(live);
    if (
      (live.conversationState?.turns.length ?? 0) > 0 &&
      pendingMaterializationThreadIdsRef.current.has(threadId)
    ) {
      pendingMaterializationThreadIdsRef.current.delete(threadId);
      await loadSelectedThreadDurable(threadId, true);
    }
  }, [loadSelectedThreadDurable]);

  const loadSelectedThreadQueue = useCallback(async (threadId: string) => {
    const sequence = ++queueRequestSequenceRef.current;
    const queue = await getQueuedFollowUps(threadId);
    if (selectedThreadIdRef.current === threadId && sequence === queueRequestSequenceRef.current) setThreadQueue(queue);
  }, []);

  useEffect(() => {
    if (!canAccessCore || !selectedThreadId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      try {
        if (document.visibilityState !== "hidden") await loadSelectedThreadQueue(selectedThreadId);
      } catch (error) { handleRequestError(error); }
      if (!stopped) timer = window.setTimeout(() => void poll(), 3_000);
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void loadSelectedThreadQueue(selectedThreadId).catch(handleRequestError);
    };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [canAccessCore, selectedThreadId, loadSelectedThreadQueue, handleRequestError]);

  const loadSelectedThreadStreamEvents = useCallback(async (threadId: string) => {
    const stream = await getStreamEvents(threadId);
    if (selectedThreadIdRef.current === threadId) {
      setStreamEvents(stream.events);
    }
  }, []);

  const loadSelectedThreadAccount = useCallback(async (threadId: string) => {
    if (!multiAccountEnabled) { setAccountStatus(null); return; }
    const nextAccountStatus = await getThreadAccountStatus(threadId);
    if (selectedThreadIdRef.current === threadId) {
      setAccountStatus(nextAccountStatus);
    }
  }, [multiAccountEnabled]);

  useEffect(() => {
    if (!canAccessCore || !selectedThreadId) return;
    void loadSelectedThreadAccount(selectedThreadId).catch(handleRequestError);
  }, [canAccessCore, selectedThreadId, loadSelectedThreadAccount, handleRequestError]);

  const loadSelectedThreadSettings = useCallback(async (threadId: string) => {
    const nextThreadSettings = await getThreadSettings(threadId);
    if (selectedThreadIdRef.current === threadId) {
      setThreadSettings(nextThreadSettings);
    }
  }, []);

  const refreshSelectedThread = useCallback(async (
    threadId: string,
    trigger: "sse" | "connected-timer" | "disconnected-timer",
    isThreadActive: boolean
  ) => {
    const refreshMode = getThreadRefreshMode(trigger, isThreadActive);
    if (refreshMode === "durable-and-live") {
      await Promise.all([
        loadSelectedThreadLive(threadId),
        loadSelectedThreadDurable(threadId, true)
      ]);
      return;
    }
    if (refreshMode === "durable-only") {
      await loadSelectedThreadDurable(threadId, true);
      return;
    }
    if (refreshMode === "live-only") {
      await loadSelectedThreadLive(threadId);
    }
  }, [loadSelectedThreadDurable, loadSelectedThreadLive]);

  const loadSelectedThreadInitial = useCallback(async (threadId: string) => {
    const requests: Array<Promise<void>> = [
      loadSelectedThreadLive(threadId),
      loadSelectedThreadDurable(threadId),
      loadSelectedThreadSettings(threadId)
    ];
    if (activeTabRef.current === "debug") {
      requests.push(loadSelectedThreadStreamEvents(threadId));
    }
    await Promise.all(requests);
  }, [loadSelectedThreadDurable, loadSelectedThreadLive, loadSelectedThreadSettings, loadSelectedThreadStreamEvents]);

  const refreshAll = useCallback(async () => {
    try {
      setError("");
      const session = await loadAuthContext();
      if (session.requiresAuth && !session.authenticated) {
        setActiveTab("chat");
        setTraceStatus(null);
        setHistory([]);
        setLiveState(null);
        setReadThreadState(null);
        setStreamEvents([]);
        return;
      }

      await loadCoreData();
      loadOptionalCoreData(session);
    } catch (e) {
      handleRequestError(e);
    }
  }, [handleRequestError, loadAuthContext, loadCoreData, loadOptionalCoreData]);

  const refreshManually = useCallback(async () => {
    await refreshAll();
    if (selectedThreadIdRef.current) {
      await loadSelectedThreadInitial(selectedThreadIdRef.current);
    }
  }, [loadSelectedThreadInitial, refreshAll]);

  const retryInitialConnection = useCallback(async (): Promise<void> => {
    if (connectionRetryInFlightRef.current) {
      return;
    }
    connectionRetryInFlightRef.current = true;
    setConnectionRetrying(true);
    try {
      await refreshAll();
    } finally {
      connectionRetryInFlightRef.current = false;
      setConnectionRetrying(false);
    }
  }, [refreshAll]);

  const handleConnectionAutoRetryChange = useCallback((enabled: boolean): void => {
    setConnectionAutoRetryEnabled(enabled);
    writeConnectionAutoRetry(window.localStorage, enabled);
  }, []);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
    activeTabRef.current = activeTab;
    setEnvironmentPanelOpen(false);
  }, [activeTab, selectedThreadId]);

  useEffect(() => {
    if (!threadListLoaded) return;
    setSelectedThreadId((current) => {
      if (!current) {
        return threads[0]?.id ?? null;
      }
      if (threads.some((thread) => thread.id === current)) {
        return current;
      }
      return threads[0]?.id ?? null;
    });
  }, [threadListLoaded, threads]);

  useEffect(() => {
    if (!threadListLoaded) return;
    writeLastThreadId(window.localStorage, selectedThreadId);
  }, [selectedThreadId, threadListLoaded]);

  useEffect(() => {
    const onPopState = () => {
      const next = parseUiStateFromPath(window.location.pathname);
      setSelectedThreadId(next.threadId);
      setActiveTab(next.tab);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    const nextPath = buildPathFromUiState(selectedThreadId, activeTab);
    if (window.location.pathname === nextPath) return;
    window.history.replaceState(null, "", nextPath);
  }, [activeTab, selectedThreadId]);

  useEffect(() => {
    clearPersistedComposerDrafts(window.localStorage);
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (authSession !== null || !error || !connectionAutoRetryEnabled) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void retryInitialConnection();
    }, 10_000);
    return () => window.clearInterval(intervalId);
  }, [authSession, connectionAutoRetryEnabled, error, retryInitialConnection]);

  useEffect(() => {
    if (!canAccessCore || !authSession) {
      if (coreRefreshIntervalRef.current) {
        window.clearInterval(coreRefreshIntervalRef.current);
      }
      coreRefreshIntervalRef.current = null;
      return;
    }
    coreRefreshIntervalRef.current = window.setInterval(() => {
      void getHealth().then(setHealth).catch(handleRequestError);
      const threadId = selectedThreadIdRef.current;
      if (threadId) {
        void Promise.all([
          loadSelectedThreadSettings(threadId),
          loadSelectedThreadAccount(threadId)
        ]).catch((e) => handleRequestError(e));
      }
    }, getCoreRefreshIntervalMs());
    return () => {
      if (coreRefreshIntervalRef.current) window.clearInterval(coreRefreshIntervalRef.current);
    };
  }, [
    authSession,
    canAccessCore,
    handleRequestError,
    loadSelectedThreadAccount,
    loadSelectedThreadSettings
  ]);

  useEffect(() => {
    if (!canAccessCore || !authSession) {
      if (threadListRefreshIntervalRef.current) {
        window.clearInterval(threadListRefreshIntervalRef.current);
      }
      threadListRefreshIntervalRef.current = null;
      return;
    }
    threadListRefreshIntervalRef.current = window.setInterval(() => {
      void loadThreadList().catch(handleRequestError);
    }, getThreadListRefreshIntervalMs());
    return () => {
      if (threadListRefreshIntervalRef.current) {
        window.clearInterval(threadListRefreshIntervalRef.current);
      }
    };
  }, [authSession, canAccessCore, handleRequestError, loadThreadList]);

  useEffect(() => {
    if (!canAccessCore) {
      setLiveState(null);
      setComposerDraft("");
      setReadThreadState(null);
      setStreamEvents([]);
      setAccountStatus(null);
      setThreadSettings(null);
      return;
    }

    if (!selectedThreadId) {
      setLiveState(null);
      setComposerDraft("");
      setReadThreadState(null);
      setStreamEvents([]);
      setAccountStatus(null);
      setThreadSettings(null);
      return;
    }
    wasGeneratingRef.current = false;
    setComposerDraft("");
    setLiveState(null);
    setReadThreadState(null);
    setStreamEvents([]);
    setAccountStatus(null);
    setThreadSettings(null);
    void loadSelectedThreadInitial(selectedThreadId).catch((e) => handleRequestError(e));
  }, [canAccessCore, handleRequestError, loadSelectedThreadInitial, selectedThreadId]);

  useEffect(() => {
    if (!canAccessCore || !selectedThread) {
      selectedThreadRevisionRef.current = null;
      return;
    }

    const listRevision = `${String(selectedThread.updatedAt)}:${selectedThread.status?.type ?? "unknown"}`;
    const liveConversation =
      liveState?.threadId === selectedThread.id &&
      liveState.conversationState?.id === selectedThread.id
        ? liveState.conversationState
        : null;
    const liveRevision = liveConversation
      ? `${String(getConversationStateUpdatedAt(liveConversation))}:${String(
          liveConversation.turns.reduce(
            (count, turn) => count + (turn.items?.length ?? 0),
            0
          )
        )}`
      : "none";
    const previous = selectedThreadRevisionRef.current;

    if (!previous || previous.threadId !== selectedThread.id) {
      selectedThreadRevisionRef.current = {
        threadId: selectedThread.id,
        listRevision,
        liveRevision
      };
      return;
    }
    if (previous.listRevision === listRevision) {
      return;
    }

    selectedThreadRevisionRef.current = {
      threadId: selectedThread.id,
      listRevision,
      liveRevision
    };
    if (previous.liveRevision !== liveRevision) {
      return;
    }

    void loadSelectedThreadDurable(selectedThread.id, true).catch((error) =>
      handleRequestError(error)
    );
  }, [
    canAccessCore,
    handleRequestError,
    liveState,
    loadSelectedThreadDurable,
    selectedThread
  ]);

  useEffect(() => {
    if (!canAccessCore || !authSession) {
      setLiveConnectionState("connecting");
      setSseReconnectAttempt(0);
      return;
    }

    setLiveConnectionState(sseReconnectAttempt > 0 ? "reconnecting" : "connecting");
    const source = new EventSource("/events");
    const liveRefreshTask = new CoalescedTask(async () => {
      const threadId = selectedThreadIdRef.current;
      if (threadId) {
        const requests: Array<Promise<void>> = [loadSelectedThreadLive(threadId), loadSelectedThreadQueue(threadId)];
        if (activeTabRef.current === "debug") {
          requests.push(loadSelectedThreadStreamEvents(threadId));
        }
        await Promise.all(requests).catch(handleRequestError);
      }
    }, 50);
    const debugHistoryRefreshTask = new CoalescedTask(async () => {
      const nextHistory = await listDebugHistory(120);
      setHistory(nextHistory.history);
    }, 250);
    const handleThreadLiveStateChanged = (event: MessageEvent<string>): void => {
      try {
        const notification = parseThreadLiveStateChangedEvent(event.data);
        if (notification.threadId === selectedThreadIdRef.current) {
          liveRefreshTask.schedule();
        }
      } catch (eventError) {
        handleRequestError(eventError);
      }
    };
    source.addEventListener("thread-live-state-changed", handleThreadLiveStateChanged);
    source.onopen = () => {
      setLiveConnectionState("connected");
      liveRefreshTask.schedule();
    };
    source.onmessage = (event) => {
      setLiveConnectionState("connected");
      const notification = parseGenericSseEvent(event.data);
      if (
        notification?.type === "queued-follow-ups-changed" &&
        notification.threadId === selectedThreadIdRef.current
      ) {
        liveRefreshTask.schedule();
      } else if (
        notification?.type === "history" &&
        authSession.debugAvailable &&
        activeTabRef.current === "debug"
      ) {
        debugHistoryRefreshTask.schedule();
      }
    };
    source.onerror = () => {
      setLiveConnectionState("reconnecting");
      source.close();
      if (sseReconnectTimerRef.current !== null) {
        window.clearTimeout(sseReconnectTimerRef.current);
      }
      sseReconnectTimerRef.current = window.setTimeout(() => {
        sseReconnectTimerRef.current = null;
        setSseReconnectAttempt((attempt) => attempt + 1);
      }, 1200);
      void loadAuthContext()
        .then((session) => {
          if (session.requiresAuth && !session.authenticated) {
            setError("Session expired. Enter your password to continue.");
          }
        })
        .catch((e) => handleRequestError(e));
    };
    return () => {
      if (sseReconnectTimerRef.current !== null) {
        window.clearTimeout(sseReconnectTimerRef.current);
      }
      liveRefreshTask.cancel();
      debugHistoryRefreshTask.cancel();
      source.removeEventListener("thread-live-state-changed", handleThreadLiveStateChanged);
      source.close();
    };
  }, [authSession, canAccessCore, handleRequestError, loadAuthContext, loadSelectedThreadLive, loadSelectedThreadQueue, loadSelectedThreadStreamEvents, sseReconnectAttempt]);

  useEffect(() => {
    if (activeTab !== "debug" || !debugTabAvailable || !selectedThreadId) {
      return;
    }
    void loadSelectedThreadStreamEvents(selectedThreadId).catch(handleRequestError);
  }, [activeTab, debugTabAvailable, handleRequestError, loadSelectedThreadStreamEvents, selectedThreadId]);

  useEffect(() => {
    if (!pendingResponseState) {
      return;
    }

    if (pendingResponseState.threadId !== selectedThreadId) {
      return;
    }

    if (isGenerating) {
      setPendingResponseState(null);
      return;
    }

    const conversationUpdatedAt = getConversationStateUpdatedAt(conversationState);
    const hasConversationProgress =
      conversationUpdatedAt > pendingResponseState.baselineUpdatedAt ||
      conversationItemCount > pendingResponseState.baselineItemCount;

    if (hasConversationProgress) {
      setPendingResponseState(null);
      if (selectedThreadId) {
        void loadSelectedThreadDurable(selectedThreadId, true).catch((e) =>
          handleRequestError(e)
        );
      }
    }
  }, [
    conversationItemCount,
    conversationState,
    isGenerating,
    pendingResponseState,
    selectedThreadId,
    handleRequestError,
    loadSelectedThreadDurable
  ]);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }
    setAcknowledgedMessages((current) => current.filter(
      (message) =>
        message.threadId !== selectedThreadId ||
        conversationItemCount <= message.baselineItemCount
    ));
  }, [conversationItemCount, selectedThreadId]);

  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    wasGeneratingRef.current = isGenerating;
    if (!wasGenerating || isGenerating || !canAccessCore || !selectedThreadId) {
      return;
    }
    if (getThreadRefreshMode("generation-settled") === "durable-only") {
      void loadSelectedThreadDurable(selectedThreadId, true).catch((e) =>
        handleRequestError(e)
      );
    }
  }, [canAccessCore, handleRequestError, isGenerating, loadSelectedThreadDurable, selectedThreadId]);

  useEffect(() => {
    if (selectedThreadPollIntervalRef.current !== null) {
      window.clearInterval(selectedThreadPollIntervalRef.current);
      selectedThreadPollIntervalRef.current = null;
    }

    if (!canAccessCore || !selectedThreadId) {
      return;
    }

    const refreshTrigger =
      liveConnectionState === "connected" ? "connected-timer" : "disconnected-timer";
    const refreshMode = getThreadRefreshMode(refreshTrigger, selectedThreadIsActive);
    const refreshIntervalMs = getThreadRefreshIntervalMs(refreshTrigger);
    if (refreshMode === "none" || refreshIntervalMs === null) {
      return;
    }
    selectedThreadPollIntervalRef.current = window.setInterval(() => {
      void refreshSelectedThread(
        selectedThreadId,
        refreshTrigger,
        selectedThreadIsActive
      ).catch((e) => handleRequestError(e));
    }, refreshIntervalMs);

    return () => {
      if (selectedThreadPollIntervalRef.current !== null) {
        window.clearInterval(selectedThreadPollIntervalRef.current);
        selectedThreadPollIntervalRef.current = null;
      }
    };
  }, [
    canAccessCore,
    handleRequestError,
    liveConnectionState,
    refreshSelectedThread,
    selectedThreadIsActive,
    selectedThreadId
  ]);

  useEffect(() => {
    if (!debugTabAvailable && activeTab === "debug") {
      setActiveTab("chat");
    }
  }, [activeTab, debugTabAvailable]);

  useEffect(() => {
    if (!activeRequest) {
      setSelectedRequestId(null);
      setAnswerDraft({});
      return;
    }
    setSelectedRequestId((cur) => cur ?? activeRequest.id);
    setAnswerDraft((prev) => {
      const next: Record<string, { option: string; freeform: string }> = {};
      for (const q of activeRequest.params.questions) {
        next[q.id] = prev[q.id] ?? { option: "", freeform: "" };
      }
      return next;
    });
  }, [activeRequest]);

  useEffect(() => {
    if (!threadSettings) return;
    setSelectedModelId(threadSettings.model);
    setSelectedReasoningEffort(normalizeReasoningEffort(threadSettings.reasoningEffort));
  }, [threadSettings]);

  useEffect(() => {
    const cs = conversationState;
    if (!cs) return;
    const remoteSelection = readModeSelectionFromConversationState(cs, threadSettings);
    const remoteModeKey = remoteSelection.modeKey || selectedModeKey || defaultModeOption?.mode || "";
    const remoteSignature = buildModeSignature(
      remoteModeKey,
      remoteSelection.modelId,
      remoteSelection.reasoningEffort
    );

    if (!hasHydratedModeFromLiveState) {
      if (remoteModeKey) setSelectedModeKey(remoteModeKey);
      setSelectedModelId(remoteSelection.modelId);
      setSelectedReasoningEffort(remoteSelection.reasoningEffort);
      lastAppliedModeSignatureRef.current = remoteSignature;
      setHasHydratedModeFromLiveState(true);
      return;
    }

    const localSignature = buildModeSignature(selectedModeKey, selectedModelId, selectedReasoningEffort);
    if (remoteSignature === localSignature) {
      lastAppliedModeSignatureRef.current = remoteSignature;
      if (isModeSyncing) {
        setIsModeSyncing(false);
      }
      return;
    }

    if (remoteSelection.modeKey) {
      setSelectedModeKey(remoteSelection.modeKey);
    } else if (!selectedModeKey && remoteModeKey) {
      setSelectedModeKey(remoteModeKey);
    }
    setSelectedModelId(remoteSelection.modelId);
    setSelectedReasoningEffort(remoteSelection.reasoningEffort);
    lastAppliedModeSignatureRef.current = remoteSignature;
    if (isModeSyncing) {
      setIsModeSyncing(false);
    }
  }, [
    conversationState,
    defaultModeOption?.mode,
    hasHydratedModeFromLiveState,
    isModeSyncing,
    selectedModeKey,
    selectedModelId,
    selectedReasoningEffort,
    threadSettings
  ]);

  useEffect(() => {
    lastAppliedModeSignatureRef.current = "";
    setHasHydratedModeFromLiveState(false);
    setIsModeSyncing(false);
    setCommandNotice("");
    setThreadSettings(null);
  }, [selectedThreadId]);

  useEffect(() => {
    writeSidebarCollapsedGroupsToStorage(sidebarCollapsedGroups);
  }, [sidebarCollapsedGroups]);

  useEffect(() => {
    window.localStorage.setItem(
      DISPLAY_PREFERENCES_STORAGE_KEY,
      JSON.stringify(displayPreferences)
    );
  }, [displayPreferences]);

  // Track whether chat view is at the bottom.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current) {
      return;
    }

    const scroller = scrollRef.current;
    const updateBottomState = () => {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      setIsChatAtBottom(distanceFromBottom <= 48);
    };

    updateBottomState();
    scroller.addEventListener("scroll", updateBottomState, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", updateBottomState);
    };
  }, [activeTab, selectedThreadId]);

  // Keep chat pinned to bottom only if user is already at the bottom.
  useEffect(() => {
    if (activeTab === "chat" && isChatAtBottom && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [activeTab, conversationItemCount, isChatAtBottom]);

  // Keep bottom pinned when expanded/collapsed blocks change chat height.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current || !chatContentRef.current) return;
    const scroller = scrollRef.current;
    const content = chatContentRef.current;
    const observer = new ResizeObserver(() => {
      if (!isChatAtBottom) return;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [activeTab, isChatAtBottom, selectedThreadId]);

  // New thread selection starts at the bottom.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setIsChatAtBottom(true);
    setVisibleChatItemLimit(INITIAL_VISIBLE_CHAT_ITEMS);
  }, [activeTab, selectedThreadId]);

  // Prevent sliding animations when switching chats.
  useEffect(() => {
    setSuppressEntryAnimations(true);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!suppressEntryAnimations) return;
    if (!selectedThreadId) {
      setSuppressEntryAnimations(false);
      return;
    }
    if (!conversationState) return;
    const timer = window.setTimeout(() => setSuppressEntryAnimations(false), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [conversationState, selectedThreadId, suppressEntryAnimations]);

  /* Actions */
  const copyCommand = useCallback(async (command: string) => {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      setError("Clipboard is unavailable in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      window.setTimeout(() => {
        setCopiedCommand((current) => (current === command ? "" : current));
      }, 1200);
    } catch (e) {
      handleRequestError(e);
    }
  }, [handleRequestError]);

  const submitPassword = useCallback(async () => {
    if (isAuthSubmitting) return;
    // Read the input itself: password managers can fill it without a React change event.
    const trimmed = passwordInputRef.current?.value.trim() ?? "";
    if (!trimmed) {
      setError("Enter your password to continue.");
      return;
    }

    setIsAuthSubmitting(true);
    try {
      setError("");
      await loginWithPin(trimmed);
      await refreshAll();
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsAuthSubmitting(false);
    }
  }, [isAuthSubmitting, handleRequestError, refreshAll]);

  const logoutSession = useCallback(async () => {
    try {
      setError("");
      await logout();
      const session = await loadAuthContext();
      if (session.requiresAuth && !session.authenticated) {
        setActiveTab("chat");
      }
    } catch (e) {
      handleRequestError(e);
    }
  }, [handleRequestError, loadAuthContext]);

  const submitMessage = useCallback(async (
    draft: string,
    behavior: "queue" | "steer",
    imageIds: string[] = []
  ) => {
    if (!selectedThread || (!draft.trim() && imageIds.length === 0)) return false;
    if (imageIds.length === 0 && draft.trim().toLowerCase() === "/help") {
      setCommandNotice("Mobile commands: /status and /help. Other Codex slash commands are forwarded unchanged to the active task.");
      return true;
    }
    setCommandNotice("");
    setIsBusy(true);
    setPendingResponseState({
      threadId: selectedThread.id,
      baselineUpdatedAt: getConversationStateUpdatedAt(conversationState),
      baselineItemCount: conversationItemCount
    });
    try {
      setError("");
      await sendMessage({
        threadId: selectedThread.id,
        text: draft,
        ...(selectedThread.cwd ? { cwd: selectedThread.cwd } : {}),
        images: imageIds,
        isSteering: isResponseActive && behavior === "steer"
      });
      acknowledgedMessageSequenceRef.current += 1;
      setAcknowledgedMessages((current) => [
        ...current,
        {
          id: `${selectedThread.id}:${String(acknowledgedMessageSequenceRef.current)}`,
          threadId: selectedThread.id,
          text: draft,
          imageCount: imageIds.length,
          baselineItemCount: conversationItemCount
        }
      ]);
      pendingMaterializationThreadIdsRef.current.delete(selectedThread.id);
      void refreshAll();
      return true;
    } catch (e) {
      setPendingResponseState(null);
      handleRequestError(e);
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [conversationItemCount, conversationState, handleRequestError, isResponseActive, refreshAll, selectedThread]);

  const updateQueuedMessage = useCallback(async (messageId: string, text: string) => {
    if (!selectedThreadId) return;
    setIsBusy(true);
    try {
      setError("");
      await editQueuedFollowUp(selectedThreadId, messageId, text);
      await loadSelectedThreadQueue(selectedThreadId);
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, loadSelectedThreadQueue, selectedThreadId]);

  const removeQueuedMessage = useCallback(async (messageId: string) => {
    if (!selectedThreadId) return;
    setIsBusy(true);
    try {
      setError("");
      await deleteQueuedFollowUp(selectedThreadId, messageId);
      await loadSelectedThreadQueue(selectedThreadId);
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, loadSelectedThreadQueue, selectedThreadId]);

  const steerQueuedMessage = useCallback(async (messageId: string) => {
    if (!selectedThreadId) return;
    setIsBusy(true);
    try {
      setError("");
      await steerQueuedFollowUp(selectedThreadId, messageId);
      await loadSelectedThreadQueue(selectedThreadId);
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, loadSelectedThreadQueue, selectedThreadId]);

  const runCompactCommand = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }
    setCompactDialogState("running");
    try {
      setError("");
      await compactThread(selectedThreadId);
      setCompactDialogState("complete");
      void loadSelectedThreadDurable(selectedThreadId).catch(handleRequestError);
    } catch (e) {
      setCompactDialogState(null);
      handleRequestError(e);
    }
  }, [handleRequestError, loadSelectedThreadDurable, selectedThreadId]);

  const startSideTask = useCallback(async () => {
    if (!selectedThreadId || !selectedThread || sideTask || sideTaskStarting) {
      return;
    }
    const cwd = selectedThread.cwd?.trim() || conversationState?.cwd?.trim();
    if (!cwd) {
      setError("Side conversation requires a task workspace.");
      return;
    }
    setSideTaskStarting(true);
    try {
      setError("");
      const created = await createSideThread(selectedThreadId, cwd);
      setSideTask({ threadId: created.threadId, title: created.title });
    } catch (e) {
      handleRequestError(e);
    } finally {
      setSideTaskStarting(false);
    }
  }, [conversationState?.cwd, handleRequestError, selectedThread, selectedThreadId, sideTask, sideTaskStarting]);

  const runComposerCommand = useCallback(async (command: ComposerCommand) => {
    switch (command) {
      case "status":
        setStatusDialogOpen(true);
        return;
      case "compact":
        setCompactDialogState("confirm");
        return;
      case "side":
        await startSideTask();
    }
  }, [startSideTask]);

  const copyConversationMessage = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCommandNotice("Copied");
      window.setTimeout(() => {
        setCommandNotice((current) => (current === "Copied" ? "" : current));
      }, 1200);
    } catch (e) {
      handleRequestError(e);
      throw e;
    }
  }, [handleRequestError]);

  const editConversationMessage = useCallback(async (turnId: string, message: string) => {
    if (!selectedThreadId) {
      return;
    }
    setIsBusy(true);
    try {
      setError("");
      await editLastMessage(selectedThreadId, turnId, message);
      await loadSelectedThreadInitial(selectedThreadId);
    } catch (e) {
      handleRequestError(e);
      throw e;
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, loadSelectedThreadInitial, selectedThreadId]);

  const forkAssistantTurn = useCallback(async (turnId: string) => {
    if (!selectedThreadId) {
      return;
    }
    setIsBusy(true);
    try {
      setError("");
      const forkedThreadId = await forkThreadFromTurn(selectedThreadId, turnId);
      await loadCoreData();
      selectedThreadIdRef.current = forkedThreadId;
      setSelectedThreadId(forkedThreadId);
      setMobileSidebarOpen(false);
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, loadCoreData, selectedThreadId]);

  const applyModeDraft = useCallback(async (draft: {
    modeKey: string;
    modelId: string;
    reasoningEffort: string;
  }) => {
    if (!selectedThreadId) {
      return;
    }

    const mode = modes.find((entry) => entry.mode === draft.modeKey) ?? null;
    if (!mode) {
      return;
    }

    const signature = buildModeSignature(draft.modeKey, draft.modelId, draft.reasoningEffort);
    if (!isModeSyncing && lastAppliedModeSignatureRef.current === signature) {
      return;
    }

    const previousSignature = lastAppliedModeSignatureRef.current;
    lastAppliedModeSignatureRef.current = signature;
    setIsModeSyncing(true);
    try {
      setError("");
      await updateThreadSettings({
        threadId: selectedThreadId,
        model: draft.modelId || null,
        effort: draft.reasoningEffort || null,
        collaborationMode: {
          mode: mode.mode,
          settings: {
            model: draft.modelId || null,
            reasoning_effort: draft.reasoningEffort || null,
            developer_instructions: mode.developer_instructions ?? null
          }
        }
      });
      await loadSelectedThreadSettings(selectedThreadId);
    } catch (e) {
      lastAppliedModeSignatureRef.current = previousSignature;
      handleRequestError(e);
      void loadSelectedThreadSettings(selectedThreadId).catch(handleRequestError);
    } finally {
      setIsModeSyncing(false);
    }
  }, [handleRequestError, isModeSyncing, loadSelectedThreadSettings, modes, selectedThreadId]);

  const submitPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) return;
    const answers: Record<string, { answers: string[] }> = {};
    for (const q of activeRequest.params.questions) {
      const cur = answerDraft[q.id] ?? { option: "", freeform: "" };
      const text = cur.option || cur.freeform.trim();
      if (text) answers[q.id] = { answers: [text] };
    }
    setIsBusy(true);
    try {
      setError("");
      await submitUserInput({
        threadId: selectedThreadId,
        requestId: activeRequest.id,
        response: { answers }
      });
      await refreshAll();
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [activeRequest, answerDraft, handleRequestError, refreshAll, selectedThreadId]);

  const skipPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) return;
    setIsBusy(true);
    try {
      setError("");
      await submitUserInput({
        threadId: selectedThreadId,
        requestId: activeRequest.id,
        response: { answers: {} }
      });
      await refreshAll();
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [activeRequest, handleRequestError, refreshAll, selectedThreadId]);

  const runInterrupt = useCallback(async () => {
    if (!selectedThreadId) return;
    setIsBusy(true);
    try {
      setError("");
      await interruptThread({ threadId: selectedThreadId });
      await refreshAll();
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, refreshAll, selectedThreadId]);

  const loadHistoryDetail = useCallback(async (id: string) => {
    if (!id) { setHistoryDetail(null); return; }
    const detail = await getHistoryEntry(id);
    setHistoryDetail(detail);
  }, []);

  useEffect(() => {
    if (!debugTabAvailable) {
      return;
    }
    void loadHistoryDetail(selectedHistoryId).catch((e) => handleRequestError(e));
  }, [debugTabAvailable, handleRequestError, loadHistoryDetail, selectedHistoryId]);

  const handleAnswerChange = useCallback(
    (questionId: string, field: "option" | "freeform", value: string) => {
      setAnswerDraft((prev) => ({
        ...prev,
        [questionId]: { ...(prev[questionId] ?? { option: "", freeform: "" }), [field]: value }
      }));
    },
    []
  );

  const createNewThread = useCallback(async (projectPath: string | null) => {
    const trimmedProjectPath = projectPath?.trim() ?? null;
    if (projectPath !== null && !trimmedProjectPath) {
      setError("Cannot create thread: missing project path");
      return;
    }
    setIsBusy(true);
    try {
      setError("");
      const created = await createThread(
        trimmedProjectPath === null ? undefined : { cwd: trimmedProjectPath }
      );
      pendingMaterializationThreadIdsRef.current.add(created.threadId);
      unlistedCreatedThreadIdsRef.current.add(created.threadId);
      setThreads((current) =>
        current.some((thread) => thread.id === created.threadId)
          ? current
          : [
              {
                ...created.thread,
                sidebar: {
                  isPinned: false,
                  isProjectPinned: false,
                  isProjectless: trimmedProjectPath === null,
                  projectPath: trimmedProjectPath,
                  projectName: null,
                  projectOrder: null,
                  hasUnreadTurn: false
                }
              },
              ...current
            ]
      );
      setSelectedThreadId(created.threadId);
      selectedThreadIdRef.current = created.threadId;
      setMobileSidebarOpen(false);
      await refreshAll();
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, refreshAll]);

  const openAccountsPanel = useCallback(async () => {
    setAccountsPanelOpen(true);
    if (!multiAccountEnabled) { setAccountsStatus(null); return; }
    setAccountsLoading(true);
    try {
      setError("");
      setAccountsStatus(await getAccountsStatus());
    } catch (e) {
      handleRequestError(e);
    } finally {
      setAccountsLoading(false);
    }
  }, [handleRequestError, multiAccountEnabled]);

  const removeThread = useCallback(async (thread: Thread) => {
    if (!window.confirm(`Delete “${threadLabel(thread)}”? This cannot be undone.`)) {
      return;
    }
    setIsBusy(true);
    try {
      setError("");
      await deleteThread(thread.id);
      await loadCoreData();
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, loadCoreData]);

  const removeProject = useCallback(async (label: string, projectThreads: Thread[]) => {
    if (
      !window.confirm(
        `Delete project “${label}” and its ${String(projectThreads.length)} chats? Project files are not deleted.`
      )
    ) {
      return;
    }
    setIsBusy(true);
    try {
      setError("");
      await Promise.all(projectThreads.map((thread) => deleteThread(thread.id)));
      await loadCoreData();
    } catch (e) {
      handleRequestError(e);
    } finally {
      setIsBusy(false);
    }
  }, [handleRequestError, loadCoreData]);

  const renderSidebarContent = (viewport: "desktop" | "mobile"): React.JSX.Element => (
    <>
      <div className="flex items-center justify-between px-4 h-14 border-b border-sidebar-border shrink-0">
        <span className="text-sm font-semibold">Codex Mobile</span>
        <div className="flex items-center gap-1">
          {viewport === "desktop" && (
            <IconBtn onClick={() => setDesktopSidebarOpen(false)} title="Hide sidebar">
              <PanelLeft size={15} />
            </IconBtn>
          )}
          {viewport === "mobile" && (
            <Button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close tasks"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 pl-2 pr-0">
        {threads.length === 0 && (
          <div className="px-4 py-6 text-xs text-muted-foreground text-center">No threads</div>
        )}
        <div className="space-y-2 pr-2">
          {groupedThreads.map((group, groupIndex) => {
            const hasSelectedThread = group.threads.some((thread) => thread.id === selectedThreadId);
            const isCollapsed = hasSelectedThread ? false : Boolean(sidebarCollapsedGroups[group.key]);
            const isHistoryExpanded = Boolean(sidebarExpandedGroups[group.key]);
            let visibleThreads = isHistoryExpanded
              ? group.threads
              : group.threads.slice(0, SIDEBAR_PROJECT_PREVIEW_LIMIT);
            const selectedInGroup = group.threads.find((thread) => thread.id === selectedThreadId);
            if (
              !isHistoryExpanded &&
              selectedInGroup &&
              !visibleThreads.some((thread) => thread.id === selectedInGroup.id)
            ) {
              visibleThreads = [
                ...visibleThreads.slice(0, SIDEBAR_PROJECT_PREVIEW_LIMIT - 1),
                selectedInGroup
              ];
            }
            const hiddenThreadCount = group.threads.length - visibleThreads.length;
            return (
              <div key={group.key} className="space-y-1">
                {(groupIndex === 0 || groupedThreads[groupIndex - 1]?.section !== group.section) && (
                  <div className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.section === "pinned"
                      ? "Pinned"
                      : group.section === "tasks"
                        ? "Tasks"
                        : "Projects"}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    onClick={() =>
                      setSidebarCollapsedGroups((prev) => ({
                        ...prev,
                        [group.key]: !isCollapsed
                      }))
                    }
                    variant="ghost"
                    className="h-6 flex-1 justify-start gap-2 rounded-lg px-2 py-1 text-left text-[13px] tracking-tight font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    {isCollapsed ? (
                      <Folder size={13} className="shrink-0" />
                    ) : (
                      <FolderOpen size={13} className="shrink-0" />
                    )}
                    <span className="min-w-0 truncate">{group.label}</span>
                  </Button>
                  {group.projectPath && group.section === "projects" && (
                    <>
                      <IconBtn
                        onClick={() => void createNewThread(group.projectPath)}
                        title={`New thread in ${group.label}`}
                        disabled={isBusy}
                      >
                        <Plus size={14} />
                      </IconBtn>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            aria-label={`Project actions: ${group.label}`}
                          >
                            <MoreVertical size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => void removeProject(group.label, group.threads)}
                          >
                            <Trash2 size={14} />
                            Delete project
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                  {group.section === "tasks" && (
                    <IconBtn
                      onClick={() => void createNewThread(null)}
                      title="New task"
                      disabled={isBusy}
                    >
                      <Plus size={14} />
                    </IconBtn>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.16, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1 pl-4 pt-0.5">
                        {visibleThreads.map((thread) => {
                          const isSelected = thread.id === selectedThreadId;
                          return (
                            <div key={thread.id} className={`flex items-center rounded-xl ${isSelected ? "bg-muted/90 shadow-sm" : ""}`}>
                              <Button
                                type="button"
                                aria-current={isSelected ? "page" : undefined}
                                onClick={() => {
                                  setSelectedThreadId(thread.id);
                                  setMobileSidebarOpen(false);
                                }}
                                variant="ghost"
                                className={`min-w-0 h-auto flex flex-1 items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] tracking-tight font-normal transition-colors ${
                                  isSelected
                                    ? "text-foreground"
                                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                }`}
                              >
                                <span className="min-w-0 flex flex-1 items-center gap-1.5 leading-5">
                                {thread.status?.type === "active" && (
                                  <Loader2
                                    size={12}
                                    className="shrink-0 animate-spin text-foreground"
                                    aria-label={`Task running: ${threadLabel(thread)}`}
                                  />
                                )}
                                {thread.sidebar.hasUnreadTurn && (
                                  <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                                    aria-label={`Unread task: ${threadLabel(thread)}`}
                                    title="Unread task"
                                  />
                                )}
                                <span className="min-w-0 truncate">{threadLabel(thread)}</span>
                                </span>
                                {thread.updatedAt && (
                                  <span className="shrink-0 text-[10px] text-muted-foreground/50">
                                    {formatDate(thread.updatedAt)}
                                  </span>
                                )}
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="mr-1 h-7 w-7 shrink-0 text-muted-foreground"
                                    aria-label={`Chat actions: ${threadLabel(thread)}`}
                                  >
                                    <MoreVertical size={13} />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => void removeThread(thread)}
                                  >
                                    <Trash2 size={14} />
                                    Delete chat
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          );
                        })}
                        {group.threads.length > SIDEBAR_PROJECT_PREVIEW_LIMIT && (
                          <Button
                            type="button"
                            onClick={() =>
                              setSidebarExpandedGroups((prev) => ({
                                ...prev,
                                [group.key]: !isHistoryExpanded
                              }))
                            }
                            variant="ghost"
                            className="h-7 w-full justify-start rounded-lg px-2.5 text-xs font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          >
                            {isHistoryExpanded ? "Show less" : `Show more (${hiddenThreadCount})`}
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-3 border-t border-sidebar-border shrink-0 flex items-center gap-1.5">
        {cliOnly ? <span className="text-xs text-muted-foreground">Codex CLI</span> : multiAccountEnabled
          ? <AccountQuotaStrip status={accountStatus} now={Date.now()} />
          : <Button variant="ghost" size="sm" onClick={() => void openAccountsPanel()}>Usage and resets</Button> }
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/40 transition-colors cursor-default shrink-0"
              aria-label={systemStatusLabel}
            >
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  allSystemsReady
                    ? "bg-success"
                    : hasAnySystemFailure
                      ? "bg-danger"
                      : "bg-muted-foreground/40"
                }`}
              />
              <span className="sr-only">{systemStatusLabel}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="space-y-1 text-xs">
            <div className="font-medium">{systemStatusLabel}</div>
            <div>App: {health?.state.appReady ? "ok" : "not ready"}</div>
            {!cliOnly && <div>IPC: {health?.state.ipcConnected ? "connected" : "disconnected"}</div>}
            {!cliOnly && <div>Init: {health?.state.ipcInitialized ? "ready" : "not ready"}</div>}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="https://github.com/mehulhere/codex-web"
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <Github size={14} />
            </a>
          </TooltipTrigger>
          <TooltipContent side="top" align="end">GitHub</TooltipContent>
        </Tooltip>
      </div>
    </>
  );

  const tailscaleUpCommand = "tailscale up";
  const runRemoteCommand = "FARFIELD_AUTH_PIN=<your-pin> pnpm dev:remote";
  const tailscaleIpCommand = "tailscale ip -4";

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <TooltipProvider delayDuration={120}>
      {authSession === null ? (
        error || connectionRetrying ? (
          <ConnectionUnavailable
            autoRetryEnabled={connectionAutoRetryEnabled}
            isRetrying={connectionRetrying}
            onAutoRetryChange={handleConnectionAutoRetryChange}
            onRetry={() => void retryInitialConnection()}
          />
        ) : (
          <div className="min-h-screen flex items-center justify-center bg-background px-4">
            <div className="text-sm text-muted-foreground">Connecting to Codex Mobile...</div>
          </div>
        )
      ) : isLocked ? (
        <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">Codex Mobile is locked</h1>
              <p className="text-sm text-muted-foreground">
                Enter your password to continue with full remote control.
              </p>
            </div>

            <form
              id="remote-login"
              aria-label="Unlock Codex Mobile"
              method="post"
              action="/api/auth/login"
              autoComplete="on"
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitPassword();
              }}
            >
              <input
                id="remote-username"
                name="username"
                type="text"
                autoComplete="username"
                value="codex-mobile"
                readOnly
                tabIndex={-1}
                aria-label="Account"
                className="hidden"
              />
              <Label htmlFor="remote-password">Password</Label>
              <div className="flex items-center gap-2">
                <Input
                  ref={passwordInputRef}
                  id="remote-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  placeholder="Enter password"
                  className="h-10 text-base"
                />
                <Button type="submit" disabled={isAuthSubmitting}>
                  {isAuthSubmitting ? "Unlocking..." : "Unlock"}
                </Button>
              </div>
            </form>

            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Remote access setup</span>
                <span className="text-xs text-muted-foreground">
                  Debug: {authSession.debugAvailable ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Tailscale installed: {remoteStatus?.tailscaleInstalled ? "Yes" : "No"}</div>
                <div>Host binding: {remoteStatus?.host ?? "unknown"}:{String(remoteStatus?.port ?? 4311)}</div>
              </div>

              {[tailscaleUpCommand, runRemoteCommand, tailscaleIpCommand].map((command) => (
                <div key={command} className="flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-background px-2 py-1 text-xs overflow-x-auto">
                    {command}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => void copyCommand(command)}
                  >
                    {copiedCommand === command ? "Copied" : "Copy"}
                  </Button>
                </div>
              ))}

              <div className="space-y-1">
                <div className="text-xs font-medium">Open from iPhone:</div>
                {tailscaleConnectUrls.length > 0 ? (
                  tailscaleConnectUrls.map((url) => (
                    <div key={url} className="flex items-center gap-2">
                      <code className="flex-1 rounded-md bg-background px-2 py-1 text-xs overflow-x-auto">
                        {url}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={() => void copyCommand(url)}
                      >
                        {copiedCommand === url ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No Tailscale IPv4 address found yet. Run `tailscale up` on this Mac.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="app-shell flex bg-background text-foreground font-sans">

      {/* Mobile sidebar backdrop */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="md:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <AnimatePresence initial={false}>
        {desktopSidebarOpen && (
          <motion.aside
            key="desktop-sidebar"
            initial={{ x: -280, opacity: 0.94 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0.94 }}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.7 }}
            className="hidden md:flex fixed left-0 top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] z-30 w-64 flex-col border-r border-sidebar-border bg-sidebar shadow-xl"
          >
            {renderSidebarContent("desktop")}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile sidebar */}
      <AnimatePresence initial={false}>
        {mobileSidebarOpen && (
          <motion.aside
            key="mobile-sidebar"
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.7 }}
            className="md:hidden fixed left-0 top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] z-50 w-64 flex flex-col border-r border-sidebar-border bg-sidebar shadow-xl"
          >
            {renderSidebarContent("mobile")}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main area ───────────────────────────────────────── */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-200 ${
          desktopSidebarOpen ? "md:ml-64" : "md:ml-0"
        }`}
      >

        <TaskHeader
          cliOnly={cliOnly}
          title={selectedThread ? threadLabel(selectedThread) : "No thread selected"}
          connectionState={liveConnectionState}
          onOpenTasks={() => setMobileSidebarOpen(true)}
          onRefresh={() => void refreshManually()}
          refreshing={isBusy || isAuthSubmitting}
          actions={
            <div className="flex items-center gap-0.5 shrink-0">
            {!desktopSidebarOpen && (
              <div className="hidden md:block">
                <IconBtn onClick={() => setDesktopSidebarOpen(true)} title="Show sidebar">
                  <PanelLeft size={15} />
                </IconBtn>
              </div>
            )}
            {debugTabAvailable && (
              <IconBtn
                onClick={() => setActiveTab(activeTab === "debug" ? "chat" : "debug")}
                active={activeTab === "debug"}
                title="Debug"
              >
                <Bug size={14} />
              </IconBtn>
            )}
            <IconBtn
              onClick={() => setEnvironmentPanelOpen(true)}
              active={environmentPanelOpen}
              title="Environment"
            >
              <GitBranch size={14} />
            </IconBtn>
            {!cliOnly && <IconBtn onClick={() => void openAccountsPanel()} title={multiAccountEnabled ? "All account statuses" : "Usage and resets"}>
              <Users size={14} />
            </IconBtn>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  aria-label="Display settings"
                >
                  <Settings size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuCheckboxItem
                  checked={!displayPreferences.showDiffs}
                  onCheckedChange={(checked) =>
                    setDisplayPreferences((current) => ({
                      ...current,
                      showDiffs: checked !== true
                    }))
                  }
                >
                  Hide diffs
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={!displayPreferences.showReasoning}
                  onCheckedChange={(checked) =>
                    setDisplayPreferences((current) => ({
                      ...current,
                      showReasoning: checked !== true
                    }))
                  }
                >
                  Hide thinking
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={!displayPreferences.showCommands}
                  onCheckedChange={(checked) =>
                    setDisplayPreferences((current) => ({
                      ...current,
                      showCommands: checked !== true
                    }))
                  }
                >
                  Hide commands
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={displayPreferences.monitorCpuTemperature}
                  onCheckedChange={(checked) => setDisplayPreferences((current) => ({
                    ...current, monitorCpuTemperature: checked
                  }))}
                >
                  CPU temperature · 1m
                </DropdownMenuCheckboxItem>
                {requiresAuth && <DropdownMenuSeparator />}
                {requiresAuth && (
                  <DropdownMenuItem onSelect={() => void logoutSession()}>
                    Sign out
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <IconBtn onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </IconBtn>
            </div>
          }
        />
        {displayPreferences.monitorCpuTemperature && (
          <CpuTemperatureStatus status={deviceStatus} error={deviceStatusError}
            warningCelsius={displayPreferences.cpuWarningCelsius}
            onSettings={() => setEnvironmentPanelOpen(true)} />
        )}
        {accountsPanelOpen && (
          <AccountsPanel
            multiAccount={multiAccountEnabled}
            threadId={selectedThreadId}
            status={accountsStatus}
            loading={accountsLoading}
            onClose={() => setAccountsPanelOpen(false)}
          />
        )}
        {environmentPanelOpen && (
          <EnvironmentPanel
            summary={environmentSummary}
            deviceStatus={deviceStatus}
            deviceStatusLoading={deviceStatusLoading}
            deviceStatusError={deviceStatusError}
            onRefreshDeviceStatus={() => void refreshDeviceStatus()}
            temperatureMonitor={{
              enabled: displayPreferences.monitorCpuTemperature,
              warningCelsius: displayPreferences.cpuWarningCelsius,
              onEnabledChange: (enabled) => setDisplayPreferences((current) => ({ ...current, monitorCpuTemperature: enabled })),
              onWarningChange: (celsius) => setDisplayPreferences((current) => ({ ...current, cpuWarningCelsius: celsius }))
            }}
            onClose={() => setEnvironmentPanelOpen(false)}
          />
        )}
        {statusDialogOpen && selectedThread && (
          <StatusDialog
            multiAccount={multiAccountEnabled}
            threadTitle={threadLabel(selectedThread)}
            threadState={selectedThread.status?.type === "active" ? "Running" : "Idle"}
            model={(threadSettings?.model ?? selectedModelId) || "App default"}
            provider={threadSettings?.modelProvider ?? selectedThread.modelProvider ?? "Not reported"}
            reasoningEffort={(threadSettings?.reasoningEffort ?? selectedReasoningEffort) || "App default"}
            account={accountStatus?.accountDisplay ?? "Not assigned"}
            quota={statusQuota}
            connection={
              health?.state.appReady && (cliOnly || health.state.ipcConnected) && liveConnectionState === "connected"
                ? "Connected"
                : "Reconnecting"
            }
            onClose={() => setStatusDialogOpen(false)}
          />
        )}
        {compactDialogState && (
          <CompactDialog
            state={compactDialogState}
            onConfirm={() => void runCompactCommand()}
            onClose={() => setCompactDialogState(null)}
          />
        )}
        {commandNotice && (
          <div className="border-b border-border/70 bg-muted/40 px-4 py-2 text-xs text-foreground" role="status">
            {commandNotice}
          </div>
        )}

        {/* Error bar */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden shrink-0"
            >
              <div role="alert" className="flex items-center justify-between px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive">
                <span className="truncate">{error}</span>
                <Button
                  type="button"
                  onClick={() => setError("")}
                  variant="ghost"
                  size="icon"
                  className="ml-3 h-6 w-6 shrink-0 opacity-60 hover:opacity-100"
                >
                  <X size={13} />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Chat tab ──────────────────────────────────────── */}
        {activeTab === "chat" && (
          <div className="relative flex-1 flex flex-col min-h-0">

            {/* Conversation */}
            <div ref={scrollRef} role="log" aria-label="Conversation" className="conversation-scroll flex-1 overflow-y-auto">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={selectedThreadId ?? "__no_thread__"}
                  ref={chatContentRef}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                  className="max-w-3xl mx-auto px-4 py-8"
                >
                  {turns.length === 0 && selectedAcknowledgedMessages.length === 0 ? (
                    <div className="text-center py-20 text-sm text-muted-foreground">
                      {selectedThread ? "No messages yet" : "Select a thread from the sidebar"}
                    </div>
                  ) : (
                    <motion.div layout={allowEntryLayoutAnimations} className="space-y-8">
                      {hasHiddenChatItems && (
                        <div className="flex justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onClick={() => {
                              setVisibleChatItemLimit((limit) =>
                                Math.min(conversationItemCount, limit + VISIBLE_CHAT_ITEMS_STEP)
                              );
                            }}
                          >
                            Show older messages ({firstVisibleChatItemIndex})
                          </Button>
                        </div>
                      )}
                      {visibleTurns.map(({ turn, turnIndex, visibleItems }) => {
                        const isLastTurn = turnIndex === turns.length - 1;
                        const turnReportedInProgress =
                          isLastTurn && (isGenerating || selectedThreadIsActive);
                        const turnId = turn.id ?? turn.turnId ?? null;
                        const items = turn.items ?? [];
                        const hasFinalAnswer = items.some(
                          (item) => item.type === "agentMessage" && item.phase === "final_answer"
                        );
                        const turnInProgress =
                          turnReportedInProgress && !hasFinalAnswer;
                        const turnStartedAtMs = epochMilliseconds(
                          turn.turnStartedAtMs ?? turn.startedAt
                        );
                        const completedAtMs = epochMilliseconds(turn.completedAt);
                        const turnEndedAtMs =
                          completedAtMs ??
                          (turnStartedAtMs !== null &&
                          turn.durationMs !== null &&
                          turn.durationMs !== undefined
                            ? turnStartedAtMs + turn.durationMs
                            : epochMilliseconds(conversationState?.updatedAt));
                        const newestReasoningIndex = latestReasoningIndex(items);
                        const newestReasoningItem =
                          newestReasoningIndex === null ? null : items[newestReasoningIndex];
                        const visibleItemIndexes = new Set(
                          visibleItems.map(({ itemIndexInTurn }) => itemIndexInTurn)
                        );
                        const activeCue = turnInProgress ? activeThinkingCue(items) : null;
                        const newestReasoningHasCue =
                          newestReasoningItem?.type === "reasoning" &&
                          ((newestReasoningItem.summary ?? []).some(
                            (line) => line.trim().length > 0
                          ) ||
                            Boolean(newestReasoningItem.text?.trim()));
                        const shouldRenderActiveCue =
                          activeCue !== null &&
                          turnInProgress &&
                          (!visibleItemIndexes.has(newestReasoningIndex ?? -1) ||
                            !newestReasoningHasCue);
                        const fileChangeTotals = summarizeFileChanges(
                          items.flatMap((item) => item.type === "fileChange" ? item.changes : [])
                        );
                        return (
                          <motion.div layout={allowEntryLayoutAnimations} key={turn.turnId ?? turnIndex} className="space-y-5">
                            <AnimatePresence initial={false}>
                            {visibleItems.map(({ item, itemIndexInTurn, globalItemIndex }) => {
                              const activityOwnerIndex = isReasoningActivityItem(item)
                                ? reasoningActivityOwnerIndex(items, itemIndexInTurn)
                                : null;
                              const activityOwnerItems = activityOwnerIndex !== null
                                ? reasoningActivityItems(items, activityOwnerIndex)
                                : [];
                              const visibleActivityOwnerItems = displayPreferences.showCommands
                                ? activityOwnerItems
                                : activityOwnerItems.filter(
                                    (activityItem) =>
                                      activityItem.type !== "commandExecution" ||
                                      activityItem.status === "inProgress"
                                  );
                              const activityOwnerIsVisibleLiveReasoning =
                                activityOwnerIndex !== null &&
                                turnInProgress &&
                                activityOwnerIndex === newestReasoningIndex &&
                                visibleItemIndexes.has(activityOwnerIndex);
                              const isFirstOwnedActivity =
                                activityOwnerItems[0]?.id === item.id;
                              const renderAsReasoningActivityGroup =
                                !displayPreferences.showReasoning &&
                                activityOwnerIndex !== null &&
                                !activityOwnerIsVisibleLiveReasoning &&
                                isFirstOwnedActivity;
                              if (
                                !displayPreferences.showReasoning &&
                                activityOwnerIndex !== null &&
                                !renderAsReasoningActivityGroup
                              ) {
                                return null;
                              }
                              if (
                                !displayPreferences.showCommands &&
                                item.type === "commandExecution" &&
                                item.status !== "inProgress" &&
                                !renderAsReasoningActivityGroup
                              ) {
                                return null;
                              }
                              if (
                                renderAsReasoningActivityGroup &&
                                visibleActivityOwnerItems.length === 0
                              ) {
                                return null;
                              }
                              const itemReasoningActivityItems = item.type === "reasoning"
                                ? reasoningActivityItems(items, itemIndexInTurn).filter(
                                    (activityItem) =>
                                      displayPreferences.showCommands ||
                                      activityItem.type !== "commandExecution" ||
                                      activityItem.status === "inProgress"
                                  )
                                : renderAsReasoningActivityGroup
                                  ? visibleActivityOwnerItems
                                  : [];
                              const itemReasoningActivitySummary = item.type === "reasoning"
                                ? reasoningActivitySummary(items, itemIndexInTurn)
                                : renderAsReasoningActivityGroup
                                  ? reasoningActivitySummaryFromItems(visibleActivityOwnerItems)
                                  : null;
                              const reasoningIsActive =
                                item.type === "reasoning" &&
                                turnInProgress &&
                                itemIndexInTurn === newestReasoningIndex;
                              return (
                                <motion.div
                                  layout={allowEntryLayoutAnimations}
                                  key={item.id ?? `${turnIndex}-${itemIndexInTurn}`}
                                  initial={suppressEntryAnimations ? false : { opacity: 0, y: 12 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -8 }}
                                  transition={{ duration: 0.2, ease: "easeOut" }}
                                >
                                  <ConversationItem
                                    item={item}
                                    isLast={globalItemIndex === conversationItemCount - 1}
                                    turnIsInProgress={turnInProgress}
                                    previousItemType={items[itemIndexInTurn - 1]?.type}
                                    nextItemType={items[itemIndexInTurn + 1]?.type}
                                    showReasoning={displayPreferences.showReasoning}
                                    showDiffs={displayPreferences.showDiffs}
                                    showCommands={displayPreferences.showCommands}
                                    reasoningActivityItems={itemReasoningActivityItems}
                                    reasoningActivitySummary={itemReasoningActivitySummary}
                                    reasoningIsActive={reasoningIsActive}
                                    renderAsReasoningActivityGroup={renderAsReasoningActivityGroup}
                                    threadId={selectedThreadId ?? undefined}
                                    turnId={turnId}
                                    canEditUserMessage={!cliOnly && item.id === latestEditableUserItemId}
                                    canForkAssistantTurn={
                                      item.type === "agentMessage" &&
                                      item.phase !== "commentary" &&
                                      !turnInProgress &&
                                      turnId !== null
                                    }
                                    messageActionsDisabled={isResponseActive || isBusy}
                                    onCopyMessage={copyConversationMessage}
                                    onEditUserMessage={editConversationMessage}
                                    onForkAssistantTurn={forkAssistantTurn}
                                  />
                                </motion.div>
                              );
                            })}
                            </AnimatePresence>
                            {isLastTurn && shouldRenderActiveCue && activeCue && (
                              <ReasoningActivityGroup
                                title={activeCue}
                                items={[]}
                                isActive
                                showDiffs={displayPreferences.showDiffs}
                              />
                            )}
                            {isLastTurn && (
                              <WorkingSummary
                                status={turnInProgress ? "in-progress" : turn.status}
                                startedAtMs={turnStartedAtMs}
                                endedAtMs={turnEndedAtMs}
                              />
                            )}
                            <FileChangeSummary totals={fileChangeTotals} />
                          </motion.div>
                        );
                      })}
                      {selectedAcknowledgedMessages.map((message) => (
                        <AcknowledgedUserMessage key={message.id} message={message} />
                      ))}
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <AnimatePresence initial={false}>
              {!isChatAtBottom && turns.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="absolute left-1/2 -translate-x-1/2 bottom-[7.25rem] md:bottom-[7.75rem] z-20"
                >
                  <Button
                    type="button"
                    onClick={() => {
                      if (!scrollRef.current) return;
                      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                      setIsChatAtBottom(true);
                    }}
                    size="icon"
                    className="h-10 w-10 rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-muted"
                  >
                    <ArrowDown size={16} />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input area */}
            <div className="border-t border-border px-4 py-4 shrink-0">
              <div className="max-w-3xl mx-auto space-y-2">

                {/* Pending user input */}
                {cliOnly && selectedThreadId && liveState?.threadId === selectedThreadId && !!liveState.cliRequests?.length && (
                  <CliRequests key={selectedThreadId} requests={liveState.cliRequests} onReply={async (id, reply) => {
                    await replyToCliRequest(selectedThreadId, id, reply);
                    await loadSelectedThreadLive(selectedThreadId);
                  }} />
                )}
                <AnimatePresence>
                  {activeRequest && (
                    <PendingRequestCard
                      request={activeRequest}
                      answerDraft={answerDraft}
                      onDraftChange={handleAnswerChange}
                      onSubmit={() => void submitPendingRequest()}
                      onSkip={() => void skipPendingRequest()}
                      isBusy={isBusy}
                    />
                  )}
                </AnimatePresence>

                <FollowUpQueue
                  messages={threadQueue?.threadId === selectedThreadId ? threadQueue.messages : []}
                  busy={isBusy}
                  onEdit={updateQueuedMessage}
                  onDelete={removeQueuedMessage}
                  onSteer={steerQueuedMessage}
                />

                {/* Composer */}
                <div className="flex flex-col gap-2">
                  {isResponseActive && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 size={9} className="animate-spin" />
                      <span>
                        {isGenerating
                          ? "generating"
                          : isWaitingForResponse
                            ? "awaiting response"
                            : "running"}
                      </span>
                    </div>
                  )}
                  <ChatComposer
                    key={selectedThreadId ?? "no-thread"}
                    canSend={Boolean(selectedThread)}
                    canStartSide={turns.length > 0 && sideTask === null && !sideTaskStarting}
                    draft={composerDraft}
                    isBusy={isBusy}
                    isGenerating={isGenerating}
                    isThreadActive={selectedThreadIsActive}
                    isWaitingForResponse={isWaitingForResponse}
                    onInterrupt={runInterrupt}
                    onCommand={runComposerCommand}
                    onDraftChange={handleComposerDraftChange}
                    onSend={submitMessage}
                  />

                  {/* Toolbar */}
                  <div className="flex items-center gap-1 min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap">
                    <Button
                      type="button"
                      onClick={() => {
                        if (!planModeOption) return;
                        const nextModeKey = isPlanModeEnabled
                          ? (defaultModeOption?.mode ?? selectedModeKey)
                          : planModeOption.mode;
                        if (!nextModeKey) return;
                        setSelectedModeKey(nextModeKey);
                        void applyModeDraft({
                          modeKey: nextModeKey,
                          modelId: selectedModelId,
                          reasoningEffort: selectedReasoningEffort
                        });
                      }}
                      variant="ghost"
                      size="sm"
                      className={`h-8 shrink-0 rounded-full px-2 text-xs ${
                        isPlanModeEnabled
                          ? "bg-blue-500/15 text-blue-600 hover:bg-blue-500/20 dark:text-blue-300"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      }`}
                      disabled={!selectedThreadId || !planModeOption}
                    >
                      {isPlanModeEnabled ? <CircleDot size={10} /> : <Circle size={10} />}
                      Plan
                    </Button>
                    <Select
                      value={selectedModelId || APP_DEFAULT_VALUE}
                      onValueChange={(value) => {
                        const nextModelId = value === APP_DEFAULT_VALUE ? "" : value;
                        setSelectedModelId(nextModelId);
                        void applyModeDraft({
                          modeKey: selectedModeKey,
                          modelId: nextModelId,
                          reasoningEffort: selectedReasoningEffort
                        });
                      }}
                      disabled={!selectedThreadId || !selectedModeKey}
                    >
                      <SelectTrigger aria-label="Model" className="h-8 w-[132px] sm:w-[176px] shrink-0 rounded-full border-0 bg-transparent dark:bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0">
                        <SelectValue placeholder="Model" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value={APP_DEFAULT_VALUE}>{defaultModelId || "App default"}</SelectItem>
                        {modelOptionsWithoutAssumedDefault.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <ReasoningEffortSelect
                      value={selectedReasoningEffort}
                      options={effortOptions}
                      onValueChange={(nextReasoningEffort) => {
                        setSelectedReasoningEffort(nextReasoningEffort);
                        void applyModeDraft({
                          modeKey: selectedModeKey,
                          modelId: selectedModelId,
                          reasoningEffort: nextReasoningEffort
                        });
                      }}
                      disabled={!selectedThreadId || !selectedModeKey}
                      triggerClassName="h-8 w-[104px] sm:w-[148px] shrink-0 rounded-full border-0 bg-transparent dark:bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0"
                    />
                    <span
                      className={`inline-flex w-3 items-center justify-center text-xs text-muted-foreground transition-opacity ${
                        isModeSyncing ? "opacity-100" : "opacity-0"
                      }`}
                    >
                      <Loader2 size={10} className={isModeSyncing ? "animate-spin" : ""} />
                    </span>
                    {pendingRequests.length > 0 && (
                      <span className="shrink-0 text-xs text-amber-500 dark:text-amber-400">
                        {pendingRequests.length} pending
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Debug tab ─────────────────────────────────────── */}
        {activeTab === "debug" && debugTabAvailable && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] min-h-0 divide-y md:divide-y-0 md:divide-x divide-border overflow-hidden">

              {/* Left: History */}
              <div className="flex flex-col min-h-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                  <Activity size={13} className="text-muted-foreground" />
                  <span className="text-sm font-medium">History</span>
                  <span className="text-xs text-muted-foreground/60">{history.length} entries</span>
                </div>

                <div className="flex-1 grid grid-cols-[200px_minmax(0,1fr)] min-h-0 divide-x divide-border overflow-hidden">
                  {/* Entry list */}
                  <div className="overflow-y-auto py-1">
                    {history
                      .slice()
                      .reverse()
                      .map((entry) => (
                        <Button
                          key={entry.id}
                          type="button"
                          onClick={() => setSelectedHistoryId(entry.id)}
                          variant="ghost"
                          className={`w-full h-auto flex-col items-start justify-start gap-0 rounded-none px-3 py-2 text-left transition-colors ${
                            selectedHistoryId === entry.id
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase leading-4 ${
                                entry.direction === "in"
                                  ? "bg-success/15 text-success"
                                  : entry.direction === "out"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {entry.source} {entry.direction}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground/50 font-mono truncate">
                            {entry.at}
                          </div>
                        </Button>
                      ))}
                  </div>

                  {/* Payload detail */}
                  <div className="overflow-y-auto p-3 space-y-3">
                    {!historyDetail ? (
                      <div className="text-xs text-muted-foreground py-4">Select an entry</div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor="wait-for-replay-response"
                            className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground cursor-pointer"
                          >
                            <Checkbox
                              id="wait-for-replay-response"
                              checked={waitForReplayResponse}
                              onCheckedChange={(checked) =>
                                setWaitForReplayResponse(checked === true)
                              }
                            />
                            wait for response
                          </Label>
                          <Button
                            type="button"
                            onClick={() =>
                              void replayHistoryEntry({
                                entryId: historyDetail.entry.id,
                                waitForResponse: waitForReplayResponse
                              }).then(refreshAll)
                            }
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            Replay
                          </Button>
                        </div>
                        <pre className="font-mono text-[11px] text-muted-foreground leading-5 whitespace-pre-wrap break-words">
                          {JSON.stringify(historyDetail.fullPayload, null, 2)}
                        </pre>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Trace + Stream Events */}
              <div className="flex flex-col min-h-0 overflow-hidden divide-y divide-border">

                {/* Trace controls */}
                <div className="p-4 space-y-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Trace</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        traceStatus?.active
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {traceStatus?.active ? "recording" : "idle"}
                    </span>
                  </div>
                  <Input
                    value={traceLabel}
                    onChange={(e) => setTraceLabel(e.target.value)}
                    placeholder="label"
                    className="h-7 text-base md:text-xs"
                  />
                  <Input
                    value={traceNote}
                    onChange={(e) => setTraceNote(e.target.value)}
                    placeholder="marker note"
                    className="h-7 text-base md:text-xs"
                  />
                  <div className="flex gap-1.5">
                    {(["Start", "Mark", "Stop"] as const).map((btn) => (
                      <Button
                        key={btn}
                        type="button"
                        onClick={() => {
                          const action =
                            btn === "Start"
                              ? startTrace(traceLabel)
                              : btn === "Mark"
                              ? markTrace(traceNote)
                              : stopTrace();
                          void action.then(refreshAll);
                        }}
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                      >
                        {btn}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Stream events */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
                    <span className="text-xs font-medium">Stream Events</span>
                    <span className="text-xs text-muted-foreground/60">{streamEvents.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                    {streamEvents
                      .slice()
                      .reverse()
                      .map((evt, i) => (
                        <StreamEventCard key={i} event={evt} />
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {sideTask && (
        <SideTaskDrawer
          threadId={sideTask.threadId}
          title={sideTask.title}
          onClose={() => setSideTask(null)}
          onError={setError}
        />
      )}
      </div>
      )}
    </TooltipProvider>
  );
}
