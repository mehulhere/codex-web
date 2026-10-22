import type { z } from "zod";
import type { TurnItemSchema } from "@farfield/protocol";

type TurnItem = z.infer<typeof TurnItemSchema>;
export type ReasoningActivityItem = Extract<
  TurnItem,
  { type: "commandExecution" | "fileChange" | "webSearch" }
>;

type ActivityCategory = "editedFiles" | "readFiles" | "searched" | "ranCommands";

const CATEGORY_LABELS: ReadonlyArray<readonly [ActivityCategory, string]> = [
  ["editedFiles", "edited files"],
  ["readFiles", "read files"],
  ["searched", "searched"],
  ["ranCommands", "ran commands"]
];

const READ_ACTION_TYPES = new Set(["listFiles", "read", "readFile"]);
const EDIT_ACTION_TYPES = new Set(["edit", "write", "writeFile"]);
const SEARCH_ACTION_TYPES = new Set(["search"]);

export function isReasoningActivityItem(item: TurnItem): item is ReasoningActivityItem {
  return (
    item.type === "commandExecution" ||
    item.type === "fileChange" ||
    item.type === "webSearch"
  );
}

export function latestReasoningIndex(items: readonly TurnItem[]): number | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === "reasoning") {
      return index;
    }
  }
  return null;
}

export function activeThinkingCue(items: readonly TurnItem[]): string | null {
  const reasoningIndex = latestReasoningIndex(items);
  if (reasoningIndex !== null) {
    const reasoning = items[reasoningIndex];
    if (reasoning?.type === "reasoning") {
      const summary = (reasoning.summary ?? [])
        .map((line) => line.replaceAll("**", "").trim())
        .filter((line) => line.length > 0);
      const currentLine = summary[summary.length - 1];
      if (currentLine) {
        return currentLine;
      }
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.type === "commandExecution" && item.status === "inProgress") {
      const categories = new Set<ActivityCategory>();
      addCommandCategories(categories, item);
      const labels = CATEGORY_LABELS.flatMap(([category, label]) =>
        categories.has(category) ? [label] : []
      );
      if (labels.length > 0) {
        const activeLabels = labels.map((label) => {
          if (label === "edited files") return "Editing files";
          if (label === "read files") return "Reading files";
          if (label === "searched") return "Searching";
          return "Running commands";
        });
        return activeLabels.join(", ");
      }
      return "Running command";
    }
    if (item.type === "webSearch") {
      return "Searching";
    }
    if (item.type === "fileChange" && item.status === "inProgress") {
      return "Editing files";
    }
  }

  return null;
}

export function reasoningActivityItems(
  items: readonly TurnItem[],
  reasoningIndex: number
): ReasoningActivityItem[] {
  const activityItems: ReasoningActivityItem[] = [];
  for (let index = reasoningIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.type === "reasoning") {
      break;
    }
    if (isReasoningActivityItem(item)) {
      activityItems.push(item);
    }
  }
  return activityItems;
}

export function reasoningActivityOwnerIndex(
  items: readonly TurnItem[],
  activityIndex: number
): number | null {
  if (!items[activityIndex] || !isReasoningActivityItem(items[activityIndex])) {
    return null;
  }
  for (let index = activityIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      return null;
    }
    if (item.type === "reasoning") {
      return index;
    }
    if (item.type === "userMessage" || item.type === "steeringUserMessage") {
      return null;
    }
  }
  return null;
}

function addCommandCategories(
  categories: Set<ActivityCategory>,
  item: Extract<ReasoningActivityItem, { type: "commandExecution" }>
): void {
  const actions = item.commandActions ?? [];
  if (actions.length === 0) {
    categories.add("ranCommands");
    return;
  }

  let hasUnclassifiedAction = false;
  for (const action of actions) {
    if (READ_ACTION_TYPES.has(action.type)) {
      categories.add("readFiles");
    } else if (EDIT_ACTION_TYPES.has(action.type)) {
      categories.add("editedFiles");
    } else if (SEARCH_ACTION_TYPES.has(action.type)) {
      categories.add("searched");
    } else {
      hasUnclassifiedAction = true;
    }
  }
  if (hasUnclassifiedAction) {
    categories.add("ranCommands");
  }
}

export function reasoningActivitySummary(
  items: readonly TurnItem[],
  reasoningIndex: number
): string | null {
  return reasoningActivitySummaryFromItems(reasoningActivityItems(items, reasoningIndex));
}

export function reasoningActivitySummaryFromItems(
  items: readonly ReasoningActivityItem[]
): string | null {
  const categories = new Set<ActivityCategory>();
  for (const item of items) {
    if (item.type === "fileChange") {
      categories.add("editedFiles");
    } else if (item.type === "webSearch") {
      categories.add("searched");
    } else {
      addCommandCategories(categories, item);
    }
  }

  const labels = CATEGORY_LABELS.flatMap(([category, label]) =>
    categories.has(category) ? [label] : []
  );
  if (labels.length === 0) {
    return null;
  }
  const joined = labels.join(", ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}
