import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, ChevronRight, Loader2, Pencil, Search, Terminal } from "lucide-react";
import type { ReasoningActivityItem } from "@/lib/reasoningActivitySummary";
import { Button } from "@/components/ui/button";
import { CommandBlock } from "./CommandBlock";
import { DiffBlock } from "./DiffBlock";

interface ReasoningActivityGroupProps {
  title: string;
  items: ReasoningActivityItem[];
  isActive: boolean;
  showDiffs: boolean;
}

function SummaryIcon({ title }: { title: string }) {
  if (title.startsWith("Edited files")) return <Pencil size={13} />;
  if (title.startsWith("Read files")) return <BookOpen size={13} />;
  if (title.startsWith("Searched")) return <Search size={13} />;
  return <Terminal size={13} />;
}

export function ReasoningActivityGroup({
  title,
  items,
  isActive,
  showDiffs
}: ReasoningActivityGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = showDiffs ? items : items.filter((item) => item.type !== "fileChange");
  const canExpand = visibleItems.length > 0;

  useEffect(() => {
    if (!isActive) {
      setExpanded(false);
    }
  }, [isActive]);

  return (
    <div className="my-4">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={canExpand ? expanded : undefined}
        onClick={() => {
          if (canExpand) setExpanded((value) => !value);
        }}
        className="h-auto w-full justify-start gap-2 p-0 text-left text-sm text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
      >
        {!isActive && <SummaryIcon title={title} />}
        <span
          className={`truncate text-sm font-semibold ${isActive ? "reasoning-shimmer" : ""}`}
        >
          {title}
        </span>
        {isActive ? (
          <Loader2 size={12} className="ml-auto shrink-0 animate-spin opacity-60" />
        ) : canExpand ? (
          <ChevronRight
            size={12}
            className={`ml-auto shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
        ) : null}
      </Button>

      <AnimatePresence initial={false}>
        {canExpand && expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-3 ml-5 max-h-80 space-y-2 overflow-y-auto border-l border-border pl-3 pr-1">
              {visibleItems.map((item) => {
                if (item.type === "commandExecution") {
                  return (
                    <CommandBlock
                      key={item.id}
                      item={item}
                      isActive={isActive && item.status === "inProgress"}
                    />
                  );
                }
                if (item.type === "fileChange") {
                  return <DiffBlock key={item.id} changes={item.changes} />;
                }
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border bg-muted/20 px-3 py-2"
                  >
                    <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Web search
                    </div>
                    <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words">
                      {item.query}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
