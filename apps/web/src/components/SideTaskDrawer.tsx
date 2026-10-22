import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compactThread,
  getLiveState,
  interruptThread,
  readThread,
  sendMessage
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/ChatComposer";
import { ConversationItem } from "@/components/ConversationItem";
import type { ComposerCommand } from "@/components/SlashCommandMenu";
import { mergeConversationStates } from "@/lib/conversationState";

interface SideTaskDrawerProps {
  threadId: string;
  title: string;
  onClose: () => void;
  onError: (message: string) => void;
}

type SideThreadState = Awaited<ReturnType<typeof readThread>>["thread"];

export function SideTaskDrawer({
  threadId,
  title,
  onClose,
  onError
}: SideTaskDrawerProps): React.JSX.Element {
  const [thread, setThread] = useState<SideThreadState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const loadThread = useCallback(async () => {
    try {
      const [durable, live] = await Promise.all([
        readThread(threadId, { includeTurns: true }),
        getLiveState(threadId)
      ]);
      const liveThread = live.conversationState?.id === threadId
        ? live.conversationState
        : null;
      setThread(mergeConversationStates(liveThread, durable.thread));
    } catch (error) {
      onError(String(error));
    }
  }, [onError, threadId]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      await loadThread();
      if (!stopped) timer = window.setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [loadThread]);

  const turns = thread?.turns ?? [];
  const lastTurn = turns.at(-1);
  const isGenerating =
    lastTurn?.status === "inProgress" || lastTurn?.status === "in-progress";
  const itemCount = useMemo(
    () => turns.reduce((count, turn) => count + turn.items.length, 0),
    [turns]
  );

  const submit = useCallback(async (text: string, behavior: "queue" | "steer", images: string[]) => {
    setBusy(true);
    try {
      await sendMessage({
        threadId,
        text,
        images,
        ...(thread?.cwd ? { cwd: thread.cwd } : {}),
        isSteering: isGenerating && behavior === "steer"
      });
      await loadThread();
      return true;
    } catch (error) {
      onError(String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, [isGenerating, loadThread, onError, thread?.cwd, threadId]);

  const interrupt = useCallback(async () => {
    setBusy(true);
    try {
      await interruptThread({ threadId });
      await loadThread();
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }, [loadThread, onError, threadId]);

  const runCommand = useCallback(async (command: ComposerCommand) => {
    if (command === "status") {
      setNotice(isGenerating ? "Side conversation is running" : "Side conversation is idle");
      return;
    }
    if (command === "compact") {
      setBusy(true);
      try {
        await compactThread(threadId);
        setNotice("Compaction started");
      } catch (error) {
        onError(String(error));
      } finally {
        setBusy(false);
      }
    }
  }, [isGenerating, onError, threadId]);

  const copyMessage = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setNotice("Copied");
  }, []);

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Temporary side conversation"
      className="fixed inset-0 z-50 flex flex-col border-l border-border bg-background shadow-2xl lg:inset-y-0 lg:left-auto lg:w-[30rem]"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-muted-foreground">Temporary · not added to projects</div>
        </div>
        <Button type="button" size="icon" variant="ghost" aria-label="Close side conversation" onClick={onClose}>
          <X size={16} />
        </Button>
      </header>

      {notice && <div className="border-b border-border px-4 py-2 text-xs" role="status">{notice}</div>}

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {turns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            Ask a quick question without disrupting the main task.
          </div>
        ) : (
          <div className="space-y-7">
            {turns.map((turn, turnIndex) => {
              const turnIsInProgress = turnIndex === turns.length - 1 && isGenerating;
              const turnId = turn.id ?? turn.turnId ?? null;
              return (
                <div key={turnId ?? String(turnIndex)} className="space-y-4">
                  {turn.items.map((item, itemIndex) => (
                    <ConversationItem
                      key={item.id}
                      item={item}
                      threadId={threadId}
                      turnId={turnId}
                      isLast={itemIndex === turn.items.length - 1 && turnIndex === turns.length - 1}
                      turnIsInProgress={turnIsInProgress}
                      showReasoning
                      showDiffs
                      onCopyMessage={copyMessage}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-4">
        {isGenerating && (
          <div className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 size={10} className="animate-spin" />
            Side conversation running · {String(itemCount)} items
          </div>
        )}
        <ChatComposer
          canSend
          canStartSide={false}
          isBusy={busy}
          isGenerating={isGenerating}
          isWaitingForResponse={false}
          onCommand={runCommand}
          onInterrupt={interrupt}
          onSend={submit}
        />
      </div>
    </section>
  );
}
