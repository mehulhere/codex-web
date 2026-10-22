import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CompactDialogState = "confirm" | "running" | "complete";

interface CompactDialogProps {
  state: CompactDialogState;
  onConfirm: () => void;
  onClose: () => void;
}

export function CompactDialog({
  state,
  onConfirm,
  onClose
}: CompactDialogProps): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="compact-task-title"
        className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-2xl"
      >
        <h2 id="compact-task-title" className="text-base font-semibold">Compact task</h2>
        {state === "confirm" && (
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Compact this task's model context now? The conversation remains in the same task.
          </p>
        )}
        {state === "running" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 size={15} className="animate-spin" />
            Starting native compaction…
          </div>
        )}
        {state === "complete" && (
          <p className="mt-4 text-sm text-foreground" role="status">Compaction started</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {state === "confirm" && (
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          )}
          {state === "confirm" && (
            <Button type="button" onClick={onConfirm}>Compact task</Button>
          )}
          {state === "complete" && (
            <Button type="button" onClick={onClose}>Done</Button>
          )}
        </div>
      </section>
    </div>
  );
}
