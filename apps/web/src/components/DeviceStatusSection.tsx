import {
  Battery,
  Cpu,
  Gauge,
  Laptop,
  RefreshCw,
  Sun
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeviceStatus } from "@/lib/api";
import { CpuWarningCelsiusSchema, type DisplayPreferences } from "@/display-preferences";

export interface TemperatureMonitorControls {
  enabled: boolean;
  warningCelsius: DisplayPreferences["cpuWarningCelsius"];
  onEnabledChange: (enabled: boolean) => void;
  onWarningChange: (celsius: DisplayPreferences["cpuWarningCelsius"]) => void;
}

interface DeviceStatusSectionProps {
  status: DeviceStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  temperatureMonitor?: TemperatureMonitorControls;
}

function DeviceRow({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-sm text-foreground">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{value}</span>
    </div>
  );
}

function temperatureText(
  temperature: DeviceStatus["cpuTemperature"] | DeviceStatus["gpuTemperature"]
): string {
  return temperature.available ? `${String(temperature.celsius)}°C` : "Unavailable";
}

function batteryText(status: DeviceStatus): string {
  if (!status.battery.available) return "Unavailable";
  if (!status.acPower.available) return `${String(status.battery.percent)}%`;
  return `${String(status.battery.percent)}% · ${status.acPower.connected ? "On AC" : "On battery"}`;
}

function laptopStateText(status: DeviceStatus | null, error: string | null): string {
  if (error) return "Unreachable · Possibly suspended";
  if (!status) return "Reading status…";
  if (!status.session.available) return "Awake · Session unavailable";
  if (status.session.locked) return "Awake · Locked";
  if (status.session.idle) return "Awake · Idle";
  return "Awake · Unlocked";
}

function lastSeenText(status: DeviceStatus): string {
  return new Date(status.updatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function DeviceStatusSection({
  status,
  loading,
  error,
  onRefresh,
  temperatureMonitor
}: DeviceStatusSectionProps): React.JSX.Element {
  return (
    <section className="mt-3 border-t border-border pt-4" aria-label="Laptop status">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <div className="text-sm text-foreground">Laptop status</div>
          {error && status && (
            <div className="text-[11px] text-amber-600 dark:text-amber-300">
              Last seen {lastSeenText(status)}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          aria-label="Refresh laptop status"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {temperatureMonitor && (
        <div className="my-3 space-y-3 rounded-xl border border-border bg-muted/20 p-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            Check CPU every minute
            <input type="checkbox" className="h-4 w-4" checked={temperatureMonitor.enabled}
              onChange={(event) => temperatureMonitor.onEnabledChange(event.currentTarget.checked)} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Warn at
            <select aria-label="CPU warning temperature" className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={temperatureMonitor.warningCelsius}
              onChange={(event) => temperatureMonitor.onWarningChange(CpuWarningCelsiusSchema.parse(Number(event.currentTarget.value)))}>
              {CpuWarningCelsiusSchema.options.map((level) => <option key={level.value} value={level.value}>{level.value}°C</option>)}
            </select>
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Shows the temperature and warns while the PWA is open. Background updates may pause; returning checks again immediately.
          </p>
        </div>
      )}

      <div className="divide-y divide-border/60">
        <DeviceRow
          icon={<Laptop size={17} />}
          label="Laptop"
          value={laptopStateText(status, error)}
        />
        <DeviceRow
          icon={<Battery size={17} />}
          label="Battery"
          value={status ? batteryText(status) : "Reading…"}
        />
        <DeviceRow
          icon={<Cpu size={17} />}
          label="CPU temperature"
          value={status ? temperatureText(status.cpuTemperature) : "Reading…"}
        />
        <DeviceRow
          icon={<Gauge size={17} />}
          label="GPU temperature"
          value={status ? temperatureText(status.gpuTemperature) : "Reading…"}
        />
        <DeviceRow
          icon={<Sun size={17} />}
          label="Brightness"
          value={
            status
              ? status.brightness.available
                ? `${String(status.brightness.percent)}%`
                : "Unavailable"
              : "Reading…"
          }
        />
      </div>
    </section>
  );
}
