import { z } from "zod";

export const LAST_THREAD_STORAGE_KEY = "farfield.last-thread-id.v1";

const LastThreadIdSchema = z.string().trim().min(1);

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem" | "removeItem">;

export function readLastThreadId(storage: ReadStorage): string | null {
  const result = LastThreadIdSchema.safeParse(storage.getItem(LAST_THREAD_STORAGE_KEY));
  return result.success ? result.data : null;
}

export function writeLastThreadId(
  storage: WriteStorage,
  threadId: string | null
): void {
  if (threadId === null) {
    storage.removeItem(LAST_THREAD_STORAGE_KEY);
    return;
  }

  storage.setItem(LAST_THREAD_STORAGE_KEY, LastThreadIdSchema.parse(threadId));
}
