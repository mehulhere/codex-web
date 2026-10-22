export type ClientErrorKind =
  | "window-error"
  | "unhandled-rejection"
  | "react-error-boundary"
  | "request-error";

type ClientErrorDetails = Record<string, string | undefined>;

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 8_000;
const DUPLICATE_REPORT_WINDOW_MS = 30_000;
const recentReports = new Map<string, number>();
let installed = false;

function safeText(value: string, limit: number): string {
  return value
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/(pin|token|cookie|authorization)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]")
    .slice(0, limit);
}

function errorParts(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: safeText(error.message || "Unknown frontend error", MAX_MESSAGE_LENGTH),
      ...(error.stack ? { stack: safeText(error.stack, MAX_STACK_LENGTH) } : {})
    };
  }
  return { message: safeText(String(error), MAX_MESSAGE_LENGTH) };
}

export function reportClientError(
  error: unknown,
  kind: ClientErrorKind,
  details: ClientErrorDetails = {}
): void {
  const parts = errorParts(error);
  const payload = {
    kind,
    ...parts,
    url: window.location.href.slice(0, 1_000),
    userAgent: navigator.userAgent.slice(0, 500),
    timestamp: Date.now(),
    details: Object.fromEntries(
      Object.entries(details)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([key, value]) => [key.slice(0, 80), safeText(value, 500)])
    )
  };

  const fingerprint = JSON.stringify({
    kind: payload.kind,
    message: payload.message,
    details: payload.details
  });
  const previousReportAt = recentReports.get(fingerprint);
  if (
    previousReportAt !== undefined &&
    payload.timestamp - previousReportAt < DUPLICATE_REPORT_WINDOW_MS
  ) {
    return;
  }
  recentReports.set(fingerprint, payload.timestamp);
  for (const [key, reportedAt] of recentReports) {
    if (payload.timestamp - reportedAt >= DUPLICATE_REPORT_WINDOW_MS) {
      recentReports.delete(key);
    }
  }

  console.error("[farfield-frontend-error]", payload);
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => undefined);
}

export function installClientErrorLogging(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportClientError(
      event.error ?? event.message,
      "window-error",
      { filename: event.filename, line: String(event.lineno), column: String(event.colno) }
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, "unhandled-rejection");
  });
}
