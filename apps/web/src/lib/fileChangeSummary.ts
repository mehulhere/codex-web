import type { FileChangeEntry } from "@farfield/protocol";

export interface FileChangeTotals {
  files: number;
  added: number;
  removed: number;
}

export function summarizeFileChanges(changes: FileChangeEntry[]): FileChangeTotals {
  let added = 0;
  let removed = 0;
  const latestChangeByPath = new Map<string, FileChangeEntry>();

  for (const change of changes) {
    latestChangeByPath.set(change.path, change);
  }

  for (const change of latestChangeByPath.values()) {
    for (const line of change.diff?.split("\n") ?? []) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) added += 1;
      if (line.startsWith("-")) removed += 1;
    }
  }

  return {
    files: latestChangeByPath.size,
    added,
    removed
  };
}
