import type { z } from "zod";
import { useState } from "react";
import type { TurnItemSchema } from "@farfield/protocol";
import { ReasoningBlock } from "./ReasoningBlock";
import { ReasoningActivityGroup } from "./ReasoningActivityGroup";
import {
  reasoningActivitySummaryFromItems,
  type ReasoningActivityItem
} from "@/lib/reasoningActivitySummary";
import { CommandBlock } from "./CommandBlock";
import { DiffBlock } from "./DiffBlock";
import { MarkdownText } from "./MarkdownText";
import { MessageActions } from "./MessageActions";
import { MessageImages, type MessageImage } from "./MessageImages";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type TurnItem = z.infer<typeof TurnItemSchema>;
type UserMessageLikeItem = Extract<TurnItem, { type: "userMessage" | "steeringUserMessage" }>;

interface Props {
  item: TurnItem;
  isLast: boolean;
  turnIsInProgress: boolean;
  previousItemType?: TurnItem["type"] | undefined;
  nextItemType?: TurnItem["type"] | undefined;
  showReasoning: boolean;
  showDiffs: boolean;
  showCommands?: boolean;
  reasoningActivityItems?: ReasoningActivityItem[];
  reasoningActivitySummary?: string | null;
  reasoningIsActive?: boolean;
  renderAsReasoningActivityGroup?: boolean;
  threadId?: string | undefined;
  turnId?: string | null;
  canEditUserMessage?: boolean;
  canForkAssistantTurn?: boolean;
  messageActionsDisabled?: boolean;
  onCopyMessage?: (text: string) => void | Promise<void>;
  onEditUserMessage?: (turnId: string, message: string) => void | Promise<void>;
  onForkAssistantTurn?: (turnId: string) => void | Promise<void>;
}

const TOOL_BLOCK_TYPES: readonly TurnItem["type"][] = [
  "commandExecution",
  "fileChange",
  "webSearch"
];

function isToolBlockType(type: TurnItem["type"] | undefined): boolean {
  return type !== undefined && TOOL_BLOCK_TYPES.includes(type);
}

function toolBlockSpacingClass(
  previousItemType: TurnItem["type"] | undefined,
  nextItemType: TurnItem["type"] | undefined
): string {
  const previousIsTool = isToolBlockType(previousItemType);
  const nextIsTool = isToolBlockType(nextItemType);
  if (previousIsTool && nextIsTool) return "my-1";
  if (previousIsTool) return "mt-1 mb-4";
  if (nextIsTool) return "mt-4 mb-1";
  return "my-4";
}

function readTextContent(content: UserMessageLikeItem["content"]): { text: string; prefix: string } {
  const text = content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
  const normalized = text.trimStart();
  const plain = { text, prefix: "" };
  const attachmentEnvelope = "# Files mentioned by the user:";
  const browserEnvelope = '<in-app-browser-context source="ambient-ui-state">';
  if (!normalized.startsWith(attachmentEnvelope) && !normalized.startsWith(browserEnvelope)) {
    return plain;
  }
  const requestHeading = /^## My request(?: for Codex)?:[ \t]*\r?\n/m;
  const firstMarker = requestHeading.exec(normalized);
  if (!firstMarker) return plain;
  const candidateBrowserStart = normalized.indexOf(browserEnvelope);
  const browserStart = candidateBrowserStart < firstMarker.index ? candidateBrowserStart : -1;
  const browserEnd = normalized.indexOf("</in-app-browser-context>", browserStart);
  if (browserStart >= 0 && browserEnd < 0) return plain;
  const searchStart = browserStart >= 0 ? browserEnd + "</in-app-browser-context>".length : 0;
  const marker = requestHeading.exec(normalized.slice(searchStart));
  if (!marker) return plain;
  const requestStart = searchStart + marker.index + marker[0].length;
  const request = normalized.slice(requestStart);
  if (!request.trim()) return plain;
  // Only the display is shortened; editing retains the original context envelope.
  const prefixEnd = text.length - normalized.length + requestStart + request.length - request.trimStart().length;
  return { text: request.trim(), prefix: text.slice(0, prefixEnd) };
}

function imageCount(item: TurnItem): number {
  switch (item.type) {
    case "userMessage":
    case "steeringUserMessage":
      return item.content.filter(
        (part) => part.type === "image" || part.type === "localImage"
      ).length;
    case "imageView":
    case "imageGeneration":
      return 1;
    case "dynamicToolCall":
      return (item.contentItems ?? []).filter((content) => content.type === "inputImage").length;
    default:
      return 0;
  }
}

function messageImages(threadId: string | undefined, item: TurnItem): MessageImage[] {
  if (!threadId) {
    return [];
  }
  return Array.from({ length: imageCount(item) }, (_, index) => ({
    src: `/api/threads/${encodeURIComponent(threadId)}/media/${encodeURIComponent(item.id)}/${String(index)}`
  }));
}

export function ConversationItem({
  item,
  isLast,
  turnIsInProgress,
  previousItemType,
  nextItemType,
  showReasoning,
  showDiffs,
  showCommands = true,
  reasoningActivityItems = [],
  reasoningActivitySummary = null,
  reasoningIsActive = false,
  renderAsReasoningActivityGroup = false,
  threadId,
  turnId = null,
  canEditUserMessage = false,
  canForkAssistantTurn = false,
  messageActionsDisabled = false,
  onCopyMessage = () => undefined,
  onEditUserMessage = () => undefined,
  onForkAssistantTurn = () => undefined
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const isActive = item.type === "reasoning"
    ? reasoningIsActive
    : isLast && turnIsInProgress;
  const toolSpacing = toolBlockSpacingClass(previousItemType, nextItemType);
  const images = messageImages(threadId, item);
  const visibleReasoningActivityItems = showCommands
    ? reasoningActivityItems
    : reasoningActivityItems.filter(
        (activityItem) =>
          activityItem.type !== "commandExecution" || activityItem.status === "inProgress"
      );
  const visibleReasoningActivitySummary = renderAsReasoningActivityGroup
    ? reasoningActivitySummaryFromItems(visibleReasoningActivityItems)
    : reasoningActivitySummary;

  if (renderAsReasoningActivityGroup && visibleReasoningActivitySummary) {
    return (
      <ReasoningActivityGroup
        title={visibleReasoningActivitySummary}
        items={visibleReasoningActivityItems}
        isActive={false}
        showDiffs={showDiffs}
      />
    );
  }

  /* ── User message ───────────────────────────────────── */
  if (item.type === "userMessage" || item.type === "steeringUserMessage") {
    const { text, prefix } = readTextContent(item.content);
    if (!text && images.length === 0) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%]">
          <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-foreground leading-relaxed">
            {editing ? (
              <div className="space-y-2">
                <Textarea
                  aria-label="Edit message text"
                  value={editDraft}
                  onChange={(event) => setEditDraft(event.target.value)}
                  className="min-h-24 bg-background"
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    aria-label="Save edit"
                    disabled={!turnId || !editDraft.trim()}
                    onClick={() => {
                      if (!turnId) return;
                      void Promise.resolve(onEditUserMessage(turnId, `${prefix}${editDraft}`))
                        .then(() => setEditing(false))
                        .catch(() => undefined);
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
                <MessageImages images={images} />
              </>
            )}
          </div>
          <div className="flex justify-end">
            <MessageActions
              canEdit={canEditUserMessage}
              canFork={false}
              disabled={turnIsInProgress || messageActionsDisabled}
              onCopy={() => onCopyMessage(text)}
              onEdit={() => {
                setEditDraft(text);
                setEditing(true);
              }}
              onFork={() => undefined}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ── Agent message ──────────────────────────────────── */
  if (item.type === "agentMessage") {
    if (!item.text) return null;
    return (
      <div>
        <MarkdownText text={item.text} threadId={threadId} itemId={item.id} />
        {item.phase === "final_answer" && (
          <MessageActions
            canEdit={false}
            canFork={canForkAssistantTurn}
            disabled={turnIsInProgress || messageActionsDisabled}
            onCopy={() => onCopyMessage(item.text)}
            onEdit={() => undefined}
            onFork={() => turnId ? onForkAssistantTurn(turnId) : undefined}
          />
        )}
      </div>
    );
  }

  if (
    item.type === "imageView" ||
    item.type === "imageGeneration" ||
    item.type === "dynamicToolCall"
  ) {
    if (images.length > 0) {
      return <MessageImages images={images} />;
    }
  }

  /* ── Reasoning ──────────────────────────────────────── */
  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.filter((s): s is string => typeof s === "string")
      : [];
    if (summary.length === 0 && !item.text) return null;
    if (!showReasoning) {
      if (!reasoningIsActive) return null;
      const liveTitle = summary[summary.length - 1]?.replaceAll("**", "").trim() || "Thinking…";
      return (
        <ReasoningActivityGroup
          title={liveTitle}
          items={reasoningActivityItems}
          isActive={reasoningIsActive}
          showDiffs={showDiffs}
        />
      );
    }
    return (
      <ReasoningBlock
        summary={summary.length > 0 ? summary : ["Thinking…"]}
        text={item.text}
        isActive={reasoningIsActive}
      />
    );
  }

  /* ── Plan ───────────────────────────────────────────── */
  if (item.type === "plan") {
    return (
      <div className="my-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Plan
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {item.text}
        </div>
      </div>
    );
  }

  /* ── User input response ────────────────────────────── */
  if (item.type === "userInputResponse") {
    const answersText = Object.entries(item.answers)
      .map(([_id, vals]) => vals.join(", "))
      .join("\n");
    if (!answersText) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl border border-border bg-muted/30 px-4 py-2.5">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider font-medium">
            Response
          </div>
          <div className="text-sm text-foreground whitespace-pre-wrap">{answersText}</div>
        </div>
      </div>
    );
  }

  /* ── Command execution ──────────────────────────────── */
  if (item.type === "commandExecution") {
    if (!showCommands && item.status !== "inProgress") return null;
    return (
      <div className={toolSpacing}>
        <CommandBlock item={item} isActive={isActive} />
      </div>
    );
  }

  /* ── File change ────────────────────────────────────── */
  if (item.type === "fileChange") {
    if (!showDiffs) return null;
    return (
      <div className={toolSpacing}>
        <DiffBlock changes={item.changes} />
      </div>
    );
  }

  /* ── Context compaction ─────────────────────────────── */
  if (item.type === "contextCompaction") {
    return (
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Context compacted
      </div>
    );
  }

  /* ── Web search ─────────────────────────────────────── */
  if (item.type === "webSearch") {
    return (
      <div className={`${toolSpacing} rounded-lg border border-border bg-muted/20 px-3 py-2`}>
        <div className="text-[10px] text-muted-foreground font-mono mb-1 uppercase tracking-wider">
          Web search
        </div>
        <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words">
          {item.query}
        </div>
      </div>
    );
  }

  return null;
}
