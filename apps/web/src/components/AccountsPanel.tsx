import { Loader2, X } from "lucide-react";
import type { AccountsStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { UsageResetControls } from "./UsageResetControls";

interface AccountsPanelProps {
  multiAccount: boolean;
  status: AccountsStatus | null;
  loading: boolean;
  threadId: string | null;
  onClose: () => void;
}

function formatWait(waitMs: number): string {
  if (waitMs <= 0) return "";
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return `${String(minutes)}m`;
}

export function AccountsPanel({ status, loading, onClose, threadId, multiAccount }: AccountsPanelProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 px-4 pt-[calc(env(safe-area-inset-top)+4rem)]"
      role="dialog"
      aria-modal="true"
      aria-label={multiAccount ? "Account status" : "Usage and resets"}
    >
      <div className="flex max-h-[calc(100dvh-6rem-env(safe-area-inset-top))] w-full max-w-md flex-col rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold">{multiAccount ? "Account status" : "Usage and resets"}</div>
            {multiAccount && status && (
              <div className="text-xs text-muted-foreground">
                {String(status.summary.ready)} ready · {String(status.summary.total)} total
              </div>
            )}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close account status">
            <X size={16} />
          </Button>
        </div>
        <div className="min-h-0 space-y-2 overflow-y-auto p-4">
          <UsageResetControls threadId={threadId} />
          {multiAccount && loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Checking accounts
            </div>
          )}
          {multiAccount && !loading && status?.accounts.map((account) => (
            <div key={account.accountNumber} className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  account.availability === "ready"
                    ? "bg-emerald-500"
                    : account.availability === "delayed"
                      ? "bg-amber-500"
                      : "bg-red-500"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  Account {String(account.accountNumber)}
                  {account.current && <span className="text-[10px] text-muted-foreground">current</span>}
                  {status.recommendedAccountNumber === account.accountNumber && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">recommended</span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {account.availability}
                  {account.waitMs > 0 ? ` · ${formatWait(account.waitMs)}` : ""}
                  {account.reason ? ` · ${account.reason}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
