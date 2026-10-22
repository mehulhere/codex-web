import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ThreadAccountStatus } from "@/lib/api";

interface AccountQuotaStripProps {
  status: Omit<ThreadAccountStatus, "ok"> | null;
  now: number;
}

export function formatReset(resetAtMs: number | null, now: number): string {
  if (resetAtMs === null) {
    return "reset unknown";
  }
  if (resetAtMs <= now) {
    return "reset due";
  }
  const remainingMinutes = Math.max(0, Math.ceil((resetAtMs - now) / 60_000));
  if (remainingMinutes < 60) {
    return `resets in ${remainingMinutes}m`;
  }
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes === 0 ? `resets in ${hours}h` : `resets in ${hours}h ${minutes}m`;
}

export function formatAccountCommandStatus(
  status: Omit<ThreadAccountStatus, "ok"> | null,
  now: number
): string {
  if (!status || status.state !== "assigned") {
    return status?.reason ?? "Account assignment is not available yet.";
  }
  const account = `Account ${String(status.accountNumber)}${status.maskedEmail ? ` (${status.maskedEmail})` : ""}`;
  const fiveHour = status.quota5h
    ? `5h ${String(status.quota5h.remainingPercent)}% · ${formatReset(status.quota5h.resetAtMs, now)}`
    : "5h quota unavailable";
  const sevenDay = status.quota7d
    ? `7d ${String(status.quota7d.remainingPercent)}% · ${formatReset(status.quota7d.resetAtMs, now)}`
    : "7d quota unavailable";
  return `${account} · ${fiveHour} · ${sevenDay} · ${status.reason}`;
}

function quotaTone(remainingPercent: number): string {
  if (remainingPercent < 5) {
    return "text-red-500";
  }
  if (remainingPercent <= 50) {
    return "text-amber-500";
  }
  return "text-emerald-500";
}

function quotaRingColor(remainingPercent: number | null): string {
  if (remainingPercent === null) {
    return "#737373";
  }
  if (remainingPercent < 5) {
    return "#ef4444";
  }
  if (remainingPercent <= 50) {
    return "#f59e0b";
  }
  return "#22c55e";
}

function accountCountLabel(accountCount: number | null): string {
  if (accountCount === null) {
    return "Waiting for status";
  }
  return `${String(accountCount)} ${accountCount === 1 ? "account" : "accounts"}`;
}

export function AccountQuotaStrip({ status, now }: AccountQuotaStripProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  if (!status) {
    return (
      <div className="account-strip sidebar-quota-pending" aria-live="polite">
        <span className="account-dot bg-amber-500" aria-hidden="true" />
        <span className="font-medium">Account unavailable</span>
        <span className="truncate text-muted-foreground">Waiting for router status</span>
      </div>
    );
  }

  if (status.state !== "assigned" && status.poolQuota === null) {
    const pending = status?.state === "pending";
    return (
      <div className="account-strip sidebar-quota-pending" aria-live="polite">
        <span className="account-dot bg-amber-500" aria-hidden="true" />
        <span className="font-medium">{pending ? "Account pending" : "Account unavailable"}</span>
        <span className="truncate text-muted-foreground">
          {status?.reason ?? "Waiting for router status"}
        </span>
      </div>
    );
  }

  const fiveHour = status.quota5h;
  const sevenDay = status.quota7d;
  const poolSevenDay = status.poolQuota?.sevenDay;
  const poolFiveHour = status.poolQuota?.fiveHour;
  const average = poolSevenDay ? Math.round(poolSevenDay.averageRemainingPercent) : null;
  const accountCount = status.poolQuota?.accountCount ?? null;
  const hasFiveHour = fiveHour !== null || poolFiveHour !== null;
  const ringProgress = average === null ? 0 : Math.max(0, Math.min(100, average));
  const buttonLabel = average === null
    ? "Combined quota unavailable"
    : `${String(average)}% quota across ${accountCountLabel(accountCount)}`;

  return (
    <div className="sidebar-quota">
      <button
        type="button"
        className="sidebar-quota-button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={buttonLabel}
      >
        <span
          className={`sidebar-quota-ring ${average === null ? "text-muted-foreground" : quotaTone(average)}`}
          style={{
            background: `conic-gradient(${quotaRingColor(average)} ${String(ringProgress * 3.6)}deg, color-mix(in srgb, currentColor 16%, transparent) 0)`
          }}
          aria-hidden="true"
        >
          <span className="sidebar-quota-ring-value">{average === null ? "—" : String(average)}</span>
        </span>
        <span className="sidebar-quota-copy">
          <span className="sidebar-quota-label">{average === null ? "Quota unavailable" : `${String(average)}% quota`}</span>
          <span className="sidebar-quota-meta">{accountCountLabel(accountCount)}</span>
        </span>
        <ChevronDown
          size={13}
          className={`sidebar-quota-chevron ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div id={panelId} className="sidebar-quota-panel" role="tooltip">
          <span className="sidebar-quota-panel-title">Combined quota · {accountCountLabel(accountCount)}</span>
          {poolSevenDay && (
            <span>
              7-day · {String(Math.round(poolSevenDay.totalRemainingPercent))}% total · {String(average)}% average · {String(poolSevenDay.reportedCount)} of {String(accountCount)} reported
            </span>
          )}
          {poolFiveHour
            ? <span>5-hour · {String(Math.round(poolFiveHour.totalRemainingPercent))}% total · {String(Math.round(poolFiveHour.averageRemainingPercent))}% average</span>
            : <span>5-hour · unavailable</span>}
          {status.state === "assigned" && (
            <>
              <span className="sidebar-quota-panel-title">
                Account {String(status.accountNumber)}{status.maskedEmail ? ` (${status.maskedEmail})` : ""}
              </span>
              {hasFiveHour && fiveHour && <span>5h {String(fiveHour.remainingPercent)}% · {formatReset(fiveHour.resetAtMs, now)}</span>}
              {sevenDay && <span>7d {String(sevenDay.remainingPercent)}% · {formatReset(sevenDay.resetAtMs, now)}</span>}
            </>
          )}
          <span>{status.reason}{status.stale ? " · status may be stale" : ""}</span>
        </div>
      )}
    </div>
  );
}
