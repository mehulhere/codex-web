import fs from "node:fs";
import {
  DesktopSteeringRestoreContextSchema,
  QueuedFollowUpMessageSchema,
  TextQueuedFollowUpContextSchema,
  type QueuedFollowUpMessage
} from "@farfield/protocol";
import { z } from "zod";
import type { FollowUpQueueItem } from "./app-server-follow-up-queue.js";
import { resolveDesktopGlobalStatePath } from "./desktop-sidebar-state.js";

const PersistedQueueSchema = z.object({
  "queued-follow-ups": z.record(z.string(), z.array(QueuedFollowUpMessageSchema)).default({})
});

export function mergeQueuedFollowUps<Message extends { id: string; createdAt: number }>(
  ...queues: readonly Message[][]
): Message[] {
  const messages = new Map<string, Message>();
  for (const queue of queues) {
    for (const message of queue) {
      if (!messages.has(message.id)) messages.set(message.id, message);
    }
  }
  return [...messages.values()].sort((left, right) => left.createdAt - right.createdAt);
}

export function withQueuedFollowUpText(
  message: QueuedFollowUpMessage,
  text: string
): QueuedFollowUpMessage {
  return {
    ...message,
    text,
    context: {
      ...message.context,
      prompt: text
    }
  };
}

export function queuedFollowUpImageIds(message: QueuedFollowUpMessage): string[] {
  const current = DesktopSteeringRestoreContextSchema.safeParse(message.context);
  if (current.success) {
    return current.data.imageAttachments.map((image) => image.id);
  }
  const queued = TextQueuedFollowUpContextSchema.safeParse(message.context);
  return queued.success
    ? queued.data.imageAttachments.map((image) => image.id)
    : [];
}

export class DesktopFollowUpQueue {
  private readonly messagesByThreadId = new Map<string, QueuedFollowUpMessage[]>();
  private readonly operationsByThreadId = new Map<string, Promise<void>>();
  private persistedVersion: string | null = null;

  public constructor(private readonly statePath = resolveDesktopGlobalStatePath()) {}

  public refreshFromDisk(): void {
    if (!fs.existsSync(this.statePath)) return;
    const stat = fs.statSync(this.statePath);
    const version = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    if (version === this.persistedVersion) return;
    const snapshot = PersistedQueueSchema.parse(JSON.parse(fs.readFileSync(this.statePath, "utf8")));
    this.messagesByThreadId.clear();
    for (const [threadId, messages] of Object.entries(snapshot["queued-follow-ups"])) {
      this.update(threadId, messages);
    }
    this.persistedVersion = version;
  }

  public async runExclusive<T>(
    threadId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.operationsByThreadId.get(threadId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(
      () => undefined,
      () => undefined
    );
    this.operationsByThreadId.set(threadId, tail);
    try {
      return await current;
    } finally {
      if (this.operationsByThreadId.get(threadId) === tail) {
        this.operationsByThreadId.delete(threadId);
      }
    }
  }

  public update(threadId: string, messages: QueuedFollowUpMessage[]): void {
    if (messages.length === 0) {
      this.messagesByThreadId.delete(threadId);
      return;
    }
    this.messagesByThreadId.set(threadId, [...messages]);
  }

  public hasThread(threadId: string): boolean {
    return this.messagesByThreadId.has(threadId);
  }

  public list(threadId: string): FollowUpQueueItem[] {
    return (this.messagesByThreadId.get(threadId) ?? []).map((message) => ({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
      ...(message.pausedReason ? { pausedReason: message.pausedReason } : {})
    }));
  }

  public getNative(threadId: string, messageId: string): QueuedFollowUpMessage | null {
    return this.messagesByThreadId
      .get(threadId)
      ?.find((message) => message.id === messageId) ?? null;
  }

  public getNativeMessages(threadId: string): QueuedFollowUpMessage[] {
    return [...(this.messagesByThreadId.get(threadId) ?? [])];
  }

  public edit(
    threadId: string,
    messageId: string,
    text: string
  ): QueuedFollowUpMessage[] | null {
    const messages = this.messagesByThreadId.get(threadId);
    if (!messages?.some((message) => message.id === messageId)) return null;
    const edited = messages.map((message) =>
      message.id === messageId ? withQueuedFollowUpText(message, text) : message
    );
    this.update(threadId, edited);
    return edited;
  }

  public remove(threadId: string, messageId: string): QueuedFollowUpMessage[] | null {
    const messages = this.messagesByThreadId.get(threadId);
    if (!messages?.some((message) => message.id === messageId)) return null;
    const remaining = messages.filter((message) => message.id !== messageId);
    this.update(threadId, remaining);
    return remaining;
  }
}
