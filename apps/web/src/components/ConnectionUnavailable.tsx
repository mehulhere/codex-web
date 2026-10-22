import { RefreshCcw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface ConnectionUnavailableProps {
  autoRetryEnabled: boolean;
  isRetrying: boolean;
  onAutoRetryChange(enabled: boolean): void;
  onRetry(): void;
}

export function ConnectionUnavailable({
  autoRetryEnabled,
  isRetrying,
  onAutoRetryChange,
  onRetry
}: ConnectionUnavailableProps): React.JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-5 py-10">
      <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <WifiOff aria-hidden="true" size={20} />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Codex Mobile is offline</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            The laptop service is not reachable. Start Codex Mobile on the laptop, then try
            again.
          </p>
        </div>

        <Button
          className="mt-6 w-full"
          disabled={isRetrying}
          type="button"
          onClick={onRetry}
        >
          <RefreshCcw className={isRetrying ? "animate-spin" : ""} aria-hidden="true" />
          {isRetrying ? "Checking…" : "Refresh connection"}
        </Button>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-border px-3 py-3">
          <Checkbox
            id="connection-auto-retry"
            checked={autoRetryEnabled}
            onCheckedChange={(checked) => onAutoRetryChange(checked === true)}
          />
          <div className="space-y-1">
            <Label htmlFor="connection-auto-retry" className="cursor-pointer leading-4">
              Check automatically every 10 seconds
            </Label>
            <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">
              {autoRetryEnabled
                ? "This page will reconnect as soon as the laptop service returns."
                : "Turn this on to reconnect without pressing Refresh."}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
