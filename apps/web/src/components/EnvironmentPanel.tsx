import type { ReactNode } from "react";
import {
  Bot,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Laptop,
  X
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { DeviceStatusSection, type TemperatureMonitorControls } from "@/components/DeviceStatusSection";
import type { DeviceStatus } from "@/lib/api";
import type { EnvironmentSummary } from "@/lib/environmentSummary";

interface EnvironmentPanelProps {
  summary: EnvironmentSummary;
  deviceStatus: DeviceStatus | null;
  deviceStatusLoading: boolean;
  deviceStatusError: string | null;
  onRefreshDeviceStatus: () => void;
  onClose: () => void;
  temperatureMonitor?: TemperatureMonitorControls;
}

function EnvironmentRow({
  icon,
  label,
  detail,
  trailing
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{label}</div>
        {detail && <div className="truncate text-[11px] text-muted-foreground">{detail}</div>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-1.5 text-xs">{trailing}</div>}
    </div>
  );
}

export function EnvironmentPanel({
  summary,
  deviceStatus,
  deviceStatusLoading,
  deviceStatusError,
  onRefreshDeviceStatus,
  onClose,
  temperatureMonitor
}: EnvironmentPanelProps) {
  const subagentTotal = Object.values(summary.subagents).reduce(
    (total, count) => total + count,
    0
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="environment-panel-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="max-h-[82dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-card px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-3xl sm:pb-5"
      >
        <div className="flex items-center justify-between border-b border-border/70 pb-2">
          <h2 id="environment-panel-title" className="text-base font-medium">Environment</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label="Close environment"
            onClick={onClose}
          >
            <X size={15} />
          </Button>
        </div>

        <div className="divide-y divide-border/60">
          <EnvironmentRow
            icon={<FileDiff size={17} />}
            label={`${summary.changes.files} ${summary.changes.files === 1 ? "file" : "files"} changed`}
            trailing={(
              <>
                <span className="font-mono text-success">+{summary.changes.added}</span>
                <span className="font-mono text-danger">−{summary.changes.removed}</span>
              </>
            )}
          />
          <EnvironmentRow
            icon={<Laptop size={17} />}
            label="Local"
            detail={summary.cwd ?? "Not reported"}
          />
          <EnvironmentRow
            icon={<GitBranch size={17} />}
            label={summary.branch ?? "Not reported"}
            detail="Current branch"
          />
          <EnvironmentRow
            icon={<GitCommitHorizontal size={17} />}
            label="Commit or push"
            detail="Continue in Desktop"
          />
          <EnvironmentRow
            icon={<GitPullRequest size={17} />}
            label="Create pull request"
            detail="Continue in Desktop"
          />
        </div>

        <div className="mt-3 border-t border-border pt-4">
          <div className="mb-2 text-sm text-muted-foreground">Subagents</div>
          {subagentTotal === 0 ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Bot size={17} />
              <span>No subagents</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 text-xs">
              {summary.subagents.running > 0 && (
                <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-600 dark:text-blue-300">
                  {summary.subagents.running} running
                </span>
              )}
              {summary.subagents.done > 0 && (
                <span className="rounded-full bg-success/10 px-2.5 py-1 text-success">
                  {summary.subagents.done} done
                </span>
              )}
              {summary.subagents.interrupted > 0 && (
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-600 dark:text-amber-300">
                  {summary.subagents.interrupted} interrupted
                </span>
              )}
              {summary.subagents.failed > 0 && (
                <span className="rounded-full bg-danger/10 px-2.5 py-1 text-danger">
                  {summary.subagents.failed} failed
                </span>
              )}
            </div>
          )}
        </div>

        <DeviceStatusSection
          status={deviceStatus}
          loading={deviceStatusLoading}
          error={deviceStatusError}
          onRefresh={onRefreshDeviceStatus}
          {...(temperatureMonitor ? { temperatureMonitor } : {})}
        />
      </motion.section>
    </div>
  );
}
