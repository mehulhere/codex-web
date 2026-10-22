import { randomUUID } from "node:crypto";

export interface FollowUpQueueItem {
  id: string;
  text: string;
  createdAt: number;
  pausedReason?: string;
  images?: QueuedImage[];
}

export interface QueuedImage {
  id: string;
  sessionKey: string;
  filename: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif";
  size: number;
  path: string;
}

export class AppServerFollowUpQueue {
  private readonly messagesByThreadId = new Map<string, FollowUpQueueItem[]>();
  private readonly operationsByThreadId = new Map<string, Promise<void>>();
  private readonly onChange: (threadId: string) => void;

  public constructor(onChange: (threadId: string) => void = () => undefined) {
    this.onChange = onChange;
  }

  public enqueue(
    threadId: string,
    text: string,
    images: readonly QueuedImage[] = []
  ): FollowUpQueueItem {
    if (!text.trim() && images.length === 0) {
      throw new Error("Message text or image is required");
    }
    const messages = this.messagesByThreadId.get(threadId) ?? [];
    const item = {
      id: randomUUID(),
      text,
      createdAt: Date.now(),
      ...(images.length > 0 ? { images: [...images] } : {})
    };
    messages.push(item);
    this.messagesByThreadId.set(threadId, messages);
    this.onChange(threadId);
    return item;
  }

  public list(threadId: string): FollowUpQueueItem[] {
    return (this.messagesByThreadId.get(threadId) ?? []).map((message) => ({
      ...message,
      ...(message.images?.length
        ? { images: message.images.map((image) => ({ ...image })) }
        : {})
    }));
  }

  public edit(threadId: string, messageId: string, text: string): FollowUpQueueItem | null {
    const messages = this.messagesByThreadId.get(threadId);
    const index = messages?.findIndex((message) => message.id === messageId) ?? -1;
    if (!messages || index < 0) return null;
    const current = messages[index];
    if (!current) return null;
    const edited = { ...current, text };
    messages[index] = edited;
    this.onChange(threadId);
    return edited;
  }

  public remove(threadId: string, messageId: string): FollowUpQueueItem | null {
    const messages = this.messagesByThreadId.get(threadId);
    const index = messages?.findIndex((message) => message.id === messageId) ?? -1;
    if (!messages || index < 0) return null;
    const [removed] = messages.splice(index, 1);
    if (messages.length === 0) this.messagesByThreadId.delete(threadId);
    this.onChange(threadId);
    return removed ?? null;
  }

  public take(threadId: string, messageId: string): FollowUpQueueItem | null {
    return this.remove(threadId, messageId);
  }

  public size(threadId: string): number {
    return this.messagesByThreadId.get(threadId)?.length ?? 0;
  }

  public threadIds(): string[] {
    return [...this.messagesByThreadId.keys()];
  }

  public async enqueueOrSend(input: {
    threadId: string;
    text: string;
    images?: readonly QueuedImage[];
    isActive: () => Promise<boolean>;
    isOwned: () => boolean;
    send: () => Promise<void>;
  }): Promise<"queued" | "sent" | "owner-changed"> {
    let result: "queued" | "sent" | "owner-changed" = "queued";
    await this.runExclusive(input.threadId, async () => {
      if (!input.isOwned()) {
        result = "owner-changed";
        return;
      }
      const existing = this.messagesByThreadId.get(input.threadId);
      if (existing && existing.length > 0) {
        this.enqueue(input.threadId, input.text, input.images);
        result = "queued";
        return;
      }
      if (await input.isActive()) {
        if (!input.isOwned()) {
          result = "owner-changed";
          return;
        }
        this.enqueue(input.threadId, input.text, input.images);
        result = "queued";
        return;
      }
      if (!input.isOwned()) {
        result = "owner-changed";
        return;
      }
      await input.send();
      result = "sent";
    });
    return result;
  }

  public async flushReady(input: {
    isActive: (threadId: string) => Promise<boolean>;
    isOwned: (threadId: string) => boolean;
    send: (threadId: string, text: string, images?: readonly QueuedImage[]) => Promise<void>;
  }): Promise<void> {
    await Promise.all(
      this.threadIds().map((threadId) =>
        this.runExclusive(threadId, async () => {
          if (await input.isActive(threadId)) return;
          if (!input.isOwned(threadId)) return;
          const messages = this.messagesByThreadId.get(threadId);
          const message = messages?.[0];
          if (!messages || !message) {
            this.messagesByThreadId.delete(threadId);
            return;
          }
          if (message.images?.length) {
            await input.send(threadId, message.text, message.images);
          } else {
            await input.send(threadId, message.text);
          }
          messages.shift();
          if (messages.length === 0) this.messagesByThreadId.delete(threadId);
          this.onChange(threadId);
        })
      )
    );
  }

  public async handoffThread(
    threadId: string,
    send: (text: string, images?: readonly QueuedImage[]) => Promise<void>
  ): Promise<void> {
    await this.runExclusive(threadId, async () => {
      const messages = this.messagesByThreadId.get(threadId);
      while (messages && messages.length > 0) {
        const message = messages[0];
        if (!message) break;
        if (message.images?.length) {
          await send(message.text, message.images);
        } else {
          await send(message.text);
        }
        messages.shift();
        this.onChange(threadId);
      }
      if (!messages || messages.length === 0) this.messagesByThreadId.delete(threadId);
    });
  }

  public async releaseIfIdle(input: {
    threadId: string;
    isOwned: () => boolean;
    release: () => Promise<void>;
  }): Promise<boolean> {
    let released = false;
    await this.runExclusive(input.threadId, async () => {
      if (!input.isOwned()) return;
      if ((this.messagesByThreadId.get(input.threadId)?.length ?? 0) > 0) return;
      await input.release();
      released = true;
    });
    return released;
  }

  private async runExclusive(threadId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.operationsByThreadId.get(threadId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.operationsByThreadId.set(threadId, current);
    try {
      await current;
    } finally {
      if (this.operationsByThreadId.get(threadId) === current) {
        this.operationsByThreadId.delete(threadId);
      }
    }
  }
}
