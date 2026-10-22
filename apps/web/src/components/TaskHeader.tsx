import type { ReactNode } from "react";
import { Menu, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TaskHeaderProps {
  title: string;
  connectionState: "connecting" | "connected" | "reconnecting";
  onOpenTasks: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  actions?: ReactNode;
  cliOnly?: boolean;
}

export function TaskHeader({
  title,
  connectionState,
  onOpenTasks,
  onRefresh,
  refreshing = false,
  actions,
  cliOnly = false
}: TaskHeaderProps): React.JSX.Element {
  const connected = connectionState === "connected";
  return (
    <header className="task-header">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-xl md:hidden"
        onClick={onOpenTasks}
        aria-label="Open tasks"
      >
        <Menu size={17} />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium tracking-[-0.01em]">{title}</div>
      </div>
      <span
        aria-label={cliOnly ? (connected ? "CLI connected" : "CLI reconnecting") : (connected ? "Desktop connected" : "Desktop reconnecting")}
        className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground"
        onClick={onRefresh}
        aria-label="Refresh task"
      >
        <RefreshCcw size={15} className={refreshing ? "animate-spin" : ""} />
      </Button>
      {actions}
    </header>
  );
}
