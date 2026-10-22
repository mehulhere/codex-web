import { useCallback, useEffect, useRef, useState } from "react";
import { getDeviceStatus, type DeviceStatus } from "@/lib/api";

export function useDeviceStatusMonitor(enabled: boolean) {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ controller: AbortController; promise: Promise<void>; timeout: number } | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (request.current) return request.current.promise;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    setLoading(true);
    const promise = (async () => {
      try {
        const next = await getDeviceStatus(controller.signal);
        if (!controller.signal.aborted && request.current?.controller === controller) {
          setStatus(next);
          setError(null);
        }
      } catch {
        if (request.current?.controller === controller && (timedOut || !controller.signal.aborted)) {
          setError("Laptop status unavailable");
        }
      } finally {
        window.clearTimeout(timeout);
        if (request.current?.controller === controller) {
          request.current = null;
          setLoading(false);
        }
      }
    })();
    request.current = { controller, promise, timeout };
    return promise;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (request.current) {
        window.clearTimeout(request.current.timeout);
        request.current.controller.abort();
        request.current = null;
      }
      setLoading(false);
    };
  }, [enabled, refresh]);

  return { status, loading, error, refresh };
}
