import { Check, Copy, GitBranch, Pencil } from "lucide-react";
import { useState } from "react";

interface MessageActionsProps {
  canEdit: boolean;
  canFork: boolean;
  disabled: boolean;
  onCopy: () => void | Promise<void>;
  onEdit: () => void;
  onFork: () => void | Promise<void>;
}

export function MessageActions({
  canEdit,
  canFork,
  disabled,
  onCopy,
  onEdit,
  onFork
}: MessageActionsProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-1.5 flex items-center gap-1 text-muted-foreground">
      <button
        type="button"
        aria-label="Copy message"
        className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"
        onClick={() => {
          void Promise.resolve(onCopy()).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }).catch(() => undefined);
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {canEdit && (
        <button
          type="button"
          aria-label="Edit message"
          disabled={disabled}
          className="rounded-md p-1.5 hover:bg-muted hover:text-foreground disabled:opacity-40"
          onClick={onEdit}
        >
          <Pencil size={13} />
        </button>
      )}
      {canFork && (
        <button
          type="button"
          aria-label="Branch response"
          disabled={disabled}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted hover:text-foreground disabled:opacity-40"
          onClick={() => void onFork()}
        >
          <GitBranch size={13} />
          Branch
        </button>
      )}
      {copied && <span className="text-[11px]" role="status">Copied</span>}
    </div>
  );
}
