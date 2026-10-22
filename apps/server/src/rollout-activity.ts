import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import type { AppServerListThreadsResponse } from "@farfield/protocol";
import { z } from "zod";

const READ_CHUNK_BYTES = 64 * 1024;

const LifecycleRecordSchema = z.union([
  z
    .object({
      timestamp: z.string().optional(),
      type: z.literal("turn_context")
    })
    .passthrough()
    .transform((record) => ({
      activity: "active" as const,
      observedAtMs: parseTimestamp(record.timestamp)
    })),
  z
    .object({
      timestamp: z.string().optional(),
      type: z.literal("event_msg"),
      payload: z
        .object({ type: z.enum(["task_complete", "turn_aborted"]) })
        .passthrough()
    })
    .passthrough()
    .transform((record) => ({
      activity: "inactive" as const,
      observedAtMs: parseTimestamp(record.timestamp)
    })),
  z
    .object({ type: z.string() })
    .passthrough()
    .transform(() => null)
]);

export type RolloutActivity = "active" | "inactive" | "unavailable";

export type RolloutLifecycle =
  | {
      activity: Exclude<RolloutActivity, "unavailable">;
      observedAtMs: number | null;
    }
  | {
      activity: "unavailable";
      observedAtMs: null;
    };

interface CachedActivity {
  size: number;
  mtimeMs: number;
  inode: number;
  lifecycle: RolloutLifecycle;
}

function parseTimestamp(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLifecycleLine(line: string): RolloutLifecycle | null {
  if (line.trim().length === 0) {
    return null;
  }

  try {
    const parsed = LifecycleRecordSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function readLatestLifecycleRecord(rolloutPath: string, size: number): RolloutLifecycle {
  const descriptor = openSync(rolloutPath, "r");
  let position = size;
  let leadingFragment = "";

  try {
    while (position > 0) {
      const start = Math.max(0, position - READ_CHUNK_BYTES);
      const length = position - start;
      const buffer = Buffer.allocUnsafe(length);
      const bytesRead = readSync(descriptor, buffer, 0, length, start);

      const lines = `${buffer.subarray(0, bytesRead).toString("utf8")}${leadingFragment}`.split(
        /\r?\n/u
      );
      leadingFragment = start > 0 ? (lines.shift() ?? "") : "";

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const activity = parseLifecycleLine(lines[index] ?? "");
        if (activity !== null) {
          return activity;
        }
      }

      position = start;
    }

    return { activity: "unavailable", observedAtMs: null };
  } finally {
    closeSync(descriptor);
  }
}

export class RolloutActivityReader {
  private readonly cache = new Map<string, CachedActivity>();
  private readonly rolloutPathByThreadId = new Map<string, string>();

  public rememberThread(threadId: string, rolloutPath: string): void {
    this.rolloutPathByThreadId.set(threadId, rolloutPath);
  }

  public readThread(threadId: string): RolloutActivity {
    return this.readThreadLifecycle(threadId).activity;
  }

  public readThreadLifecycle(threadId: string): RolloutLifecycle {
    const rolloutPath = this.rolloutPathByThreadId.get(threadId);
    return rolloutPath
      ? this.readLifecycle(rolloutPath)
      : { activity: "unavailable", observedAtMs: null };
  }

  public read(rolloutPath: string): RolloutActivity {
    return this.readLifecycle(rolloutPath).activity;
  }

  public readLifecycle(rolloutPath: string): RolloutLifecycle {
    if (!existsSync(rolloutPath)) {
      return { activity: "unavailable", observedAtMs: null };
    }
    const stats = statSync(rolloutPath);

    const cached = this.cache.get(rolloutPath);
    if (
      cached &&
      cached.size === stats.size &&
      cached.mtimeMs === stats.mtimeMs &&
      cached.inode === stats.ino
    ) {
      return cached.lifecycle;
    }

    const lifecycle = readLatestLifecycleRecord(rolloutPath, stats.size);
    this.cache.set(rolloutPath, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      inode: stats.ino,
      lifecycle
    });
    return lifecycle;
  }
}

export function enrichThreadActivity(
  result: AppServerListThreadsResponse,
  reader: RolloutActivityReader
): AppServerListThreadsResponse {
  return {
    ...result,
    data: result.data.map((thread) => {
      if (thread.path) {
        reader.rememberThread(thread.id, thread.path);
      }

      if (
        (thread.status?.type !== "notLoaded" && thread.status?.type !== "idle") ||
        !thread.path ||
        reader.read(thread.path) !== "active"
      ) {
        return thread;
      }

      return {
        ...thread,
        status: {
          type: "active",
          activeFlags: []
        }
      };
    })
  };
}
