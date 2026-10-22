import { Cpu } from "lucide-react";
import type { DeviceStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Props {
  status: DeviceStatus | null;
  error: string | null;
  warningCelsius: number;
  onSettings: () => void;
}

export function CpuTemperatureStatus({ status, error, warningCelsius, onSettings }: Props): React.JSX.Element {
  const temperature = status?.cpuTemperature;
  const stale = error !== null || (status !== null && Date.now() - Date.parse(status.updatedAt) > 90_000);
  const hot = !stale && temperature?.available === true && temperature.celsius >= warningCelsius;
  const label = temperature?.available
    ? `CPU ${temperature.celsius}°C${stale ? " · stale" : ""}`
    : status || error ? "CPU unavailable" : "Reading CPU…";
  const checked = status ? new Date(status.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <section aria-label="CPU temperature monitor" className={`shrink-0 border-b border-border px-4 py-1.5 ${hot ? "bg-destructive/10" : "bg-muted/20"}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Button type="button" variant="ghost" size="sm" aria-label="CPU temperature settings" onClick={onSettings}
          className={`h-7 px-0 text-xs ${hot ? "text-destructive" : "text-foreground"}`}>
          <Cpu size={13} /><span aria-live="polite">{label}</span>
        </Button>
        <span className="text-[11px] text-muted-foreground">{checked ? `Last checked ${checked} · 1 min` : "Checking every minute"}</span>
      </div>
      {hot && (
        <p role="alert" className="pb-1 text-xs text-destructive">
          CPU warning level reached ({warningCelsius}°C). Check your PC and consider shutting it down if needed.
        </p>
      )}
    </section>
  );
}
