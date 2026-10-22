import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerPwa } from "../src/pwa";

describe("installable PWA", () => {
  it("declares standalone Codex Mobile metadata", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8")
    );

    expect(manifest.name).toBe("Codex Mobile");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it("registers the app-shell service worker", async () => {
    const register = vi.fn(async () => ({ scope: "/" }));
    const addEventListener = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { addEventListener, register }
    });

    await registerPwa();
    expect(register).toHaveBeenCalledWith("/service-worker.js", {
      scope: "/",
      updateViaCache: "none"
    });
    expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));
  });

  it("reloads controlled windows when a newer shell worker activates", async () => {
    interface LifecycleEvent {
      waitUntil(promise: Promise<void>): void;
    }

    type LifecycleHandler = (event: LifecycleEvent) => void;
    const handlers = new Map<string, LifecycleHandler>();
    const navigate = vi.fn(async () => undefined);
    const navigateRejected = vi.fn(async () => {
      throw new TypeError("Cannot navigate to URL");
    });
    const navigateAlreadyUpdated = vi.fn(async () => undefined);
    let activation = Promise.resolve();
    const source = readFileSync(resolve(process.cwd(), "public/service-worker.js"), "utf8");
    expect(source).toContain('const SHELL_CACHE = `${SHELL_CACHE_PREFIX}v6`;');

    runInNewContext(source, {
      URL,
      caches: {
        delete: vi.fn(async () => true),
        keys: vi.fn(async () => ["codex-mobile-shell-v2"]),
        match: vi.fn(async () => undefined),
        open: vi.fn(async () => ({ addAll: vi.fn(async () => undefined) }))
      },
      fetch: vi.fn(),
      self: {
        addEventListener: (name: string, handler: LifecycleHandler) => handlers.set(name, handler),
        clients: {
          claim: vi.fn(async () => undefined),
          matchAll: vi.fn(async () => [
            { navigate, url: "https://farfield.example.test/thread" },
            { navigate: navigateRejected, url: "https://farfield.example.test/other-thread" },
            {
              navigate: navigateAlreadyUpdated,
              url: "https://farfield.example.test/thread?farfield-shell=codex-mobile-shell-v4"
            }
          ])
        },
        location: { origin: "https://farfield.example.test" },
        skipWaiting: vi.fn()
      }
    });

    const activate = handlers.get("activate");
    expect(activate).toBeDefined();
    activate?.({
      waitUntil(promise) {
        activation = promise;
      }
    });
    await expect(activation).resolves.toBeUndefined();

    expect(navigate).toHaveBeenCalledWith(
      "https://farfield.example.test/thread"
    );
    expect(navigateAlreadyUpdated).toHaveBeenCalledWith(
      "https://farfield.example.test/thread?farfield-shell=codex-mobile-shell-v4"
    );
    expect(navigateRejected).toHaveBeenCalledWith(
      "https://farfield.example.test/other-thread"
    );
  });

  it("enables iPhone safe areas and manifest discovery", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('name="mobile-web-app-capable"');
  });

  it("offers manual and optional ten-second host recovery while offline", () => {
    const html = readFileSync(resolve(process.cwd(), "public/offline.html"), "utf8");

    expect(html).toContain("Refresh");
    expect(html).toContain("Check automatically every 10 seconds");
    expect(html).toContain("farfield.connection-auto-retry.v1");
    expect(html).toContain("/api/health");
    expect(html).toContain("10_000");
    expect(html).toContain("response.status >= 500");
  });
});
