import { Files } from "lucide-react";
import type { FileChangeTotals } from "@/lib/fileChangeSummary";

export function FileChangeSummary({ totals }: { totals: FileChangeTotals }) {
  if (totals.files === 0) return null;

  return (
    <div
      className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-muted/40 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
      aria-label={`${totals.files} files changed, ${totals.added} lines added, ${totals.removed} lines removed`}
    >
      <Files size={12} />
      <span>{totals.files} {totals.files === 1 ? "file" : "files"} changed</span>
      <span className="text-success">+{totals.added}</span>
      <span className="text-danger">−{totals.removed}</span>
    </div>
  );
}
