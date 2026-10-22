import { useState } from "react";
import { Check, Pencil, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComposerImage } from "@/lib/api";

export interface QueuedFollowUp {
  id: string;
  text: string;
  createdAt: number;
  images?: ComposerImage[];
  pausedReason?: string | undefined;
}

interface FollowUpQueueProps {
  messages: QueuedFollowUp[];
  busy: boolean;
  onEdit: (messageId: string, text: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onSteer: (messageId: string) => Promise<void>;
}

export function FollowUpQueue({
  messages,
  busy,
  onEdit,
  onDelete,
  onSteer
}: FollowUpQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (messages.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-muted/25" aria-label="Queued follow-ups">
      <div className="border-b border-border/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        {messages.length} queued
      </div>
      <div className="divide-y divide-border/70">
        {messages.map((message) => {
          const editing = editingId === message.id;
          const accessibleLabel = message.text.trim()
            || message.images?.map((image) => image.filename).join(", ")
            || "queued follow-up";
          return (
            <div key={message.id} className="flex min-w-0 items-center gap-2 px-2 py-2">
              {editing ? (
                <input
                  autoFocus
                  aria-label="Edit queued message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {message.images && message.images.length > 0 && (
                    <div className="flex shrink-0 -space-x-2">
                      {message.images.slice(0, 3).map((image) => (
                        <img
                          key={image.id}
                          src={image.url}
                          alt={image.filename}
                          className="h-9 w-9 rounded-lg border border-border bg-muted object-cover"
                        />
                      ))}
                    </div>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {message.text || (message.images?.length === 1
                      ? message.images[0]?.filename
                      : `${message.images?.length ?? 0} images`)}
                  </span>
                </div>
              )}
              {editing ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Save queued message"
                    disabled={busy || !draft.trim()}
                    onClick={() => {
                      void onEdit(message.id, draft.trim()).then(() => setEditingId(null));
                    }}
                  >
                    <Check size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Cancel queued message edit"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    <X size={14} />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    aria-label={`Steer ${accessibleLabel}`}
                    disabled={busy}
                    onClick={() => void onSteer(message.id)}
                  >
                    <Send size={12} />
                    Steer
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Edit ${accessibleLabel}`}
                    disabled={busy}
                    onClick={() => {
                      setEditingId(message.id);
                      setDraft(message.text);
                    }}
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${accessibleLabel}`}
                    disabled={busy}
                    onClick={() => void onDelete(message.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
