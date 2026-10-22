export function resolveOwnerClientId(
  threadOwnerById: Map<string, string>,
  threadId: string,
  override?: string
): string {
  const mapped = threadOwnerById.get(threadId);
  if (mapped && mapped.trim()) {
    return mapped.trim();
  }

  if (override && override.trim()) {
    return override.trim();
  }

  throw new Error(
    "No owner client id is known for this thread yet. Wait for the desktop app to publish a thread event."
  );
}

export type MessageDelivery =
  | { type: "desktop"; ownerClientId: string }
  | { type: "desktop-discovery" }
  | { type: "app-server" };

export type MessageIntent = "queue" | "steer";

export type InterruptDelivery = MessageDelivery | { type: "desktop-discovery" };

export interface MessageRuntimeReadiness {
  appReady: boolean;
  ipcConnected: boolean;
  ipcInitialized: boolean;
  lastError: string | null;
}

export type DesktopOwnershipEvidence = "composer-draft" | "thread-stream";

export function applyDesktopOwnershipEvidence(
  threadOwnerById: Map<string, string>,
  appServerOwnedThreadIds: Set<string>,
  threadId: string,
  ownerClientId: string,
  evidence: DesktopOwnershipEvidence
): void {
  if (evidence === "composer-draft") {
    return;
  }
  const normalizedOwnerClientId = ownerClientId.trim();
  if (!normalizedOwnerClientId) {
    return;
  }
  threadOwnerById.set(threadId, normalizedOwnerClientId);
  appServerOwnedThreadIds.delete(threadId);
}

export type ComposerMessageDelivery =
  | { type: "desktop-takeover" }
  | { type: "app-server" };

export function resolveComposerMessageDelivery(
  appServerOwnedThreadIds: Set<string>,
  threadId: string,
  hasInitialSettings = false
): ComposerMessageDelivery {
  return hasInitialSettings || appServerOwnedThreadIds.has(threadId)
    ? { type: "app-server" }
    : { type: "desktop-takeover" };
}

export function composerMessageDeliveryUnavailableReason(
  delivery: ComposerMessageDelivery,
  readiness: MessageRuntimeReadiness
): string | null {
  if (delivery.type === "app-server") {
    return readiness.appReady ? null : "Codex app-server is not ready";
  }
  if (readiness.ipcConnected && readiness.ipcInitialized) {
    return null;
  }
  return readiness.lastError ?? "Desktop IPC is not connected";
}

export function messageDeliveryUnavailableReason(
  delivery: MessageDelivery,
  readiness: MessageRuntimeReadiness
): string | null {
  if (delivery.type === "app-server") {
    return readiness.appReady ? null : "Codex app-server is not ready";
  }

  if (readiness.ipcConnected && readiness.ipcInitialized) {
    return null;
  }

  return readiness.lastError ?? "Desktop IPC is not connected";
}

export function interruptDeliveryUnavailableReason(
  delivery: InterruptDelivery,
  readiness: MessageRuntimeReadiness
): string | null {
  if (delivery.type === "app-server") {
    return readiness.appReady ? null : "Codex app-server is not ready";
  }

  if (readiness.ipcConnected && readiness.ipcInitialized) {
    return null;
  }

  return readiness.lastError ?? "Desktop IPC is not connected";
}

export function resolveInterruptDelivery(
  threadOwnerById: Map<string, string>,
  threadId: string,
  appServerActive: boolean,
  rolloutActive: boolean,
  override?: string
): InterruptDelivery {
  const mapped = threadOwnerById.get(threadId)?.trim();
  if (mapped) {
    return { type: "desktop", ownerClientId: mapped };
  }

  const explicit = override?.trim();
  if (explicit) {
    return { type: "desktop", ownerClientId: explicit };
  }

  if (appServerActive) {
    return { type: "app-server" };
  }

  return rolloutActive ? { type: "desktop-discovery" } : { type: "app-server" };
}

export function resolveMessageDelivery(
  threadOwnerById: Map<string, string>,
  appServerOwnedThreadIds: Set<string>,
  threadId: string,
  rolloutActive: boolean,
  _intent: MessageIntent,
  override?: string
): MessageDelivery {
  const mapped = threadOwnerById.get(threadId)?.trim();
  if (mapped) {
    return { type: "desktop", ownerClientId: mapped };
  }

  const explicit = override?.trim();
  if (explicit) {
    return { type: "desktop", ownerClientId: explicit };
  }

  if (appServerOwnedThreadIds.has(threadId)) {
    return { type: "app-server" };
  }

  if (!rolloutActive) {
    return { type: "app-server" };
  }

  return { type: "desktop-discovery" };
}

export function resolveSideMessageDelivery(
  threadOwnerById: Map<string, string>,
  appServerOwnedThreadIds: Set<string>,
  threadId: string,
  override?: string
): MessageDelivery {
  if (appServerOwnedThreadIds.has(threadId)) {
    return { type: "app-server" };
  }

  const mapped = threadOwnerById.get(threadId)?.trim();
  if (mapped) {
    return { type: "desktop", ownerClientId: mapped };
  }

  const explicit = override?.trim();
  if (explicit) {
    return { type: "desktop", ownerClientId: explicit };
  }

  return { type: "app-server" };
}
