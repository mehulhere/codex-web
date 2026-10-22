export type ThreadRefreshTrigger =
  | "selection"
  | "manual"
  | "sse"
  | "connected-timer"
  | "disconnected-timer"
  | "generation-settled";

export type ThreadRefreshMode =
  | "durable-and-live"
  | "durable-only"
  | "live-only"
  | "none";

const ThreadRefreshModeByTrigger: Record<ThreadRefreshTrigger, ThreadRefreshMode> = {
  selection: "durable-and-live",
  manual: "durable-and-live",
  sse: "live-only",
  "connected-timer": "none",
  "disconnected-timer": "live-only",
  "generation-settled": "durable-only"
};

export function getThreadRefreshMode(
  trigger: ThreadRefreshTrigger,
  _isThreadActive = false
): ThreadRefreshMode {
  return ThreadRefreshModeByTrigger[trigger];
}

export function getThreadRefreshIntervalMs(
  trigger: "connected-timer" | "disconnected-timer"
): number | null {
  return trigger === "connected-timer" ? null : 5_000;
}

export function getCoreRefreshIntervalMs(): number {
  return 15_000;
}

export function getThreadListRefreshIntervalMs(): number {
  return 5_000;
}
