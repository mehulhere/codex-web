import {
  type ThreadConversationState,
  parseThreadConversationState,
  type ThreadStreamPatch,
  type ThreadStreamStateChangedBroadcast
} from "@farfield/protocol";

export function projectLiveConversationState(
  state: ThreadConversationState,
  recentTurnCount = 2
): ThreadConversationState {
  const recentStartIndex = Math.max(0, state.turns.length - recentTurnCount);
  const turns = state.turns.filter(
    (turn, index) => index >= recentStartIndex || turn.status === "inProgress"
  );
  const { turnHistory: _turnHistory, ...stateWithoutCanonicalHistory } = state;
  return {
    ...stateWithoutCanonicalHistory,
    turns
  };
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function patchPathSegmentLabel(segment: number | string): string {
  return typeof segment === "number" ? `[${segment}]` : segment;
}

function assertPathExists(target: unknown, path: (number | string)[]): void {
  let cursor = target;
  for (const segment of path) {
    if (Array.isArray(cursor) && typeof segment === "number") {
      if (segment < 0 || segment >= cursor.length) {
        throw new Error(`Patch path segment out of range: ${patchPathSegmentLabel(segment)}`);
      }
      cursor = cursor[segment];
      continue;
    }

    if (
      cursor &&
      typeof cursor === "object" &&
      !Array.isArray(cursor) &&
      typeof segment === "string"
    ) {
      if (!Object.hasOwn(cursor, segment)) {
        throw new Error(`Patch path segment missing: ${patchPathSegmentLabel(segment)}`);
      }
      cursor = (cursor as Record<string, unknown>)[segment];
      continue;
    }

    throw new Error(`Patch path invalid at segment ${patchPathSegmentLabel(segment)}`);
  }
}

function applyPatchToMutableState(
  state: ThreadConversationState,
  patch: ThreadStreamPatch
): void {
  if (patch.path.length === 0) {
    throw new Error("Patch path cannot be empty");
  }

  const parentPath = patch.path.slice(0, -1);
  const last = patch.path[patch.path.length - 1];

  assertPathExists(state, parentPath);

  let parent: unknown = state;
  for (const segment of parentPath) {
    if (typeof segment === "number") {
      parent = (parent as unknown[])[segment];
      continue;
    }

    parent = (parent as Record<string, unknown>)[segment];
  }

  if (Array.isArray(parent) && typeof last === "number") {
    if (patch.op === "add") {
      if (last < 0 || last > parent.length) {
        throw new Error(`Patch add index out of range: ${String(last)}`);
      }
      parent.splice(last, 0, patch.value);
      return;
    }

    if (patch.op === "replace") {
      if (last < 0 || last >= parent.length) {
        throw new Error(`Patch replace index out of range: ${String(last)}`);
      }
      parent[last] = patch.value;
      return;
    }

    if (patch.op === "remove") {
      if (last < 0 || last >= parent.length) {
        throw new Error(`Patch remove index out of range: ${String(last)}`);
      }
      parent.splice(last, 1);
      return;
    }
  }

  if (
    parent &&
    typeof parent === "object" &&
    !Array.isArray(parent) &&
    typeof last === "string"
  ) {
    if (patch.op === "remove") {
      if (!Object.hasOwn(parent, last)) {
        throw new Error(`Patch remove key missing: ${last}`);
      }
      delete (parent as Record<string, unknown>)[last];
      return;
    }

    Object.defineProperty(parent, last, {
      value: patch.value,
      enumerable: true,
      configurable: true,
      writable: true
    });
    return;
  }

  throw new Error("Patch target type mismatch");
}

export function applyStrictPatch(
  source: ThreadConversationState,
  patch: ThreadStreamPatch
): ThreadConversationState {
  const state = cloneState(source);
  applyPatchToMutableState(state, patch);
  return parseThreadConversationState(state);
}

export interface ThreadStreamDerivedState {
  ownerClientId: string | null;
  conversationState: ThreadConversationState | null;
  revision: number | null;
}

export interface ThreadStreamReductionErrorDetails {
  threadId: string;
  eventIndex: number;
  patchIndex: number;
  event: ThreadStreamStateChangedBroadcast;
  patch: ThreadStreamPatch;
}

export class ThreadStreamReductionError extends Error {
  public readonly details: ThreadStreamReductionErrorDetails;

  public constructor(
    message: string,
    details: ThreadStreamReductionErrorDetails,
    cause?: unknown
  ) {
    super(message);
    this.name = "ThreadStreamReductionError";
    this.details = details;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
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

function applyThreadStreamEvent(
  previous: ThreadStreamDerivedState,
  event: ThreadStreamStateChangedBroadcast,
  eventIndex: number
): ThreadStreamDerivedState {
  const threadId = event.params.conversationId;
  const next: ThreadStreamDerivedState = {
    ownerClientId: event.sourceClientId,
    conversationState: previous.conversationState,
    revision: previous.revision
  };
  const change = event.params.change;

  if (change.type === "snapshot") {
    next.conversationState = change.conversationState;
    next.revision = change.revision;
    return next;
  }

  if (!next.conversationState) {
    // The desktop app can emit patches before the first snapshot for a thread.
    // Ignore these until we have a concrete base state.
    return next;
  }

  if (next.revision !== change.baseRevision) {
    throw new Error(
      `Thread stream revision mismatch: cached ${String(next.revision)}, patch base ${String(change.baseRevision)}`
    );
  }

  const updated = cloneState(next.conversationState);
  let patchIndex = 0;
  try {
    for (; patchIndex < change.patches.length; patchIndex += 1) {
      applyPatchToMutableState(updated, change.patches[patchIndex] as ThreadStreamPatch);
    }
    next.conversationState = parseThreadConversationState(updated);
  } catch (error) {
    const failedPatchIndex = Math.min(patchIndex, change.patches.length - 1);
    const patch = change.patches[failedPatchIndex];
    if (patch) {
      throw new ThreadStreamReductionError(
        `Thread stream reduction failed for thread ${threadId} at event ${eventIndex}, patch ${failedPatchIndex}: ${toErrorMessage(
          error
        )}`,
        {
          threadId,
          eventIndex,
          patchIndex: failedPatchIndex,
          event,
          patch
        },
        error
      );
    }
    throw error;
  }

  next.revision = change.revision;
  return next;
}

export class ThreadStreamStateAccumulator {
  private readonly byThread = new Map<string, ThreadStreamDerivedState>();
  private readonly quarantinedThreadIds = new Set<string>();

  public ingest(
    event: ThreadStreamStateChangedBroadcast,
    eventIndex = 0
  ): ThreadStreamDerivedState {
    const threadId = event.params.conversationId;
    const previous = this.byThread.get(threadId) ?? {
      ownerClientId: null,
      conversationState: null,
      revision: null
    };
    const isSnapshot = event.params.change.type === "snapshot";

    if (this.quarantinedThreadIds.has(threadId) && !isSnapshot) {
      return previous;
    }

    try {
      const next = applyThreadStreamEvent(previous, event, eventIndex);
      this.byThread.set(threadId, next);
      if (isSnapshot) {
        this.quarantinedThreadIds.delete(threadId);
      }
      return next;
    } catch (error) {
      this.quarantinedThreadIds.add(threadId);
      throw error;
    }
  }

  public isQuarantined(threadId: string): boolean {
    return this.quarantinedThreadIds.has(threadId);
  }

  public clear(): number {
    const threadCount = this.byThread.size;
    this.byThread.clear();
    this.quarantinedThreadIds.clear();
    return threadCount;
  }

  public get(threadId: string): ThreadStreamDerivedState | undefined {
    return this.byThread.get(threadId);
  }

  public snapshot(): Map<string, ThreadStreamDerivedState> {
    return new Map(this.byThread);
  }
}

export function reduceThreadStreamEvents(
  events: ThreadStreamStateChangedBroadcast[]
): Map<string, ThreadStreamDerivedState> {
  const accumulator = new ThreadStreamStateAccumulator();
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    accumulator.ingest(events[eventIndex] as ThreadStreamStateChangedBroadcast, eventIndex);
  }
  return accumulator.snapshot();
}

export function findLatestTurnParamsTemplate(
  conversationState: ThreadConversationState
): NonNullable<ThreadConversationState["turns"][number]["params"]> {
  for (let i = conversationState.turns.length - 1; i >= 0; i -= 1) {
    const turn = conversationState.turns[i];
    if (turn?.params) {
      return turn.params;
    }
  }

  throw new Error("No turn params template found in conversation state");
}
