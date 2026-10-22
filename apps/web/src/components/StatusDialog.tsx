import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StatusDialogProps {
  multiAccount?: boolean;
  threadTitle: string;
  threadState: string;
  model: string;
  provider: string;
  reasoningEffort: string;
  account: string;
  quota: string;
  connection: string;
  onClose: () => void;
}

export function StatusDialog({
  multiAccount = true,
  threadTitle,
  threadState,
  model,
  provider,
  reasoningEffort,
  account,
  quota,
  connection,
  onClose
}: StatusDialogProps): React.JSX.Element {
  const rows = [
    ["Task", threadTitle],
    ["State", threadState],
    ["Model", model],
    ["Provider", provider],
    ["Thinking", reasoningEffort],
    ...(multiAccount ? [["Account", account], ["Quota", quota]] : []),
    ["Connection", connection]
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-status-title"
        className="w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="task-status-title" className="text-base font-semibold">Task status</h2>
          <Button type="button" size="icon" variant="ghost" aria-label="Close status" onClick={onClose}>
            <X size={15} />
          </Button>
        </div>
        <dl className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
