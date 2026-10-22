import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { consumeUsageReset, getUsageResetStatus, type UsageResetStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";

const ATTEMPT_KEY = "farfield.usage-reset-attempt.v1";
const AttemptSchema = z.object({ threadId: z.string().min(1), idempotencyKey: z.string().uuid() }).strict();

export function UsageResetControls({ threadId }: { threadId: string | null }) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [status, setStatus] = useState<UsageResetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hasPendingAttempt, setHasPendingAttempt] = useState(() => window.localStorage.getItem(ATTEMPT_KEY) !== null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!threadId) return;
    let stopped = false;
    setLoading(true); setError(""); setStatus(null);
    void getUsageResetStatus(threadId).then(value => { if (!stopped) setStatus(value); })
      .catch(reason => { if (!stopped) setError(z.instanceof(Error).parse(reason).message); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [threadId, refreshVersion]);

  const useReset = async (): Promise<void> => {
    if (!threadId || inFlight.current || !status?.available || (!hasPendingAttempt && (!status.eligible || status.availableCount === 0))) return;
    if (!window.confirm("Use one full usage reset for the account signed in to Codex Desktop? This consumes one of your available resets.")) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const stored = window.localStorage.getItem(ATTEMPT_KEY);
      const attempt = stored === null ? { threadId, idempotencyKey: crypto.randomUUID() } : AttemptSchema.parse(JSON.parse(stored));
      window.localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
      setHasPendingAttempt(true);
      const response = await consumeUsageReset(attempt.threadId, attempt.idempotencyKey);
      window.localStorage.removeItem(ATTEMPT_KEY);
      setHasPendingAttempt(false);
      setStatus(response.status); setNotice(response.message);
    } catch (reason) {
      setError(`${z.instanceof(Error).parse(reason).message} Retry keeps the same reset attempt.`);
    } finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <section aria-label="Usage resets" className="space-y-2 rounded-xl border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Usage and resets</div>
        <Button type="button" variant="ghost" size="sm" disabled={!threadId || loading || busy}
          onClick={() => setRefreshVersion(version => version + 1)}>Refresh usage</Button>
      </div>
      <p className="text-xs text-muted-foreground">For the account signed in to Codex Desktop.</p>
      {!threadId && <p className="text-xs text-muted-foreground">Select a chat to manage resets.</p>}
      {loading && <p className="text-xs text-muted-foreground">Checking available resets…</p>}
      {status && (
        <>
          {status.available && <p className="text-sm">{status.availableCount} resets available</p>}
          <p className="text-xs text-muted-foreground">
            5-hour remaining: {status.fiveHourRemaining === null ? "unavailable" : `${Math.round(status.fiveHourRemaining)}%`}
            {" · "}Weekly: {status.weeklyRemaining === null ? "unavailable" : `${Math.round(status.weeklyRemaining)}%`}
          </p>
        </>
      )}
      {status?.reason && <p className="text-xs text-muted-foreground">{status.reason}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="text-xs text-foreground">{notice}</p>}
      <Button type="button" size="sm" disabled={loading || busy || !status?.available || (!hasPendingAttempt && (!status.eligible || status.availableCount === 0))}
        onClick={() => void useReset()}>{busy ? "Using reset…" : hasPendingAttempt ? "Retry reset" : "Use reset"}</Button>
    </section>
  );
}
