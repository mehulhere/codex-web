import { z } from "zod";

export const CONNECTION_AUTO_RETRY_STORAGE_KEY = "farfield.connection-auto-retry.v1";

const ConnectionAutoRetryValueSchema = z.enum(["enabled", "disabled"]);

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

export function readConnectionAutoRetry(storage: ReadStorage): boolean {
  try {
    const result = ConnectionAutoRetryValueSchema.safeParse(
      storage.getItem(CONNECTION_AUTO_RETRY_STORAGE_KEY)
    );
    return result.success && result.data === "enabled";
  } catch {
    return false;
  }
}

export function writeConnectionAutoRetry(storage: WriteStorage, enabled: boolean): void {
  try {
    storage.setItem(CONNECTION_AUTO_RETRY_STORAGE_KEY, enabled ? "enabled" : "disabled");
  } catch {
    // Storage can be unavailable in private browsing. The in-memory choice still works.
  }
}
