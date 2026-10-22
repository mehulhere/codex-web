import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ThreadConversationState
} from "@farfield/protocol";
import { App } from "../src/App";
import { LAST_THREAD_STORAGE_KEY } from "../src/last-thread-storage.js";

class MockEventSource {
  public static latest: MockEventSource | null = null;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent<string>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  public constructor(_url: string) {
    MockEventSource.latest = this;
  }

  public addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  public emit(type: string, data: string): void {
    const event = new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  public close(): void {}
}

vi.stubGlobal("EventSource", MockEventSource);

interface MockSession {
  authenticated: boolean;
  requiresAuth: boolean;
  remoteRequest: boolean;
  debugAvailable: boolean;
  expiresAt: string | null;
}

interface MockState {
  session: MockSession;
  failThreadsWithAuthExpired: boolean;
  failLiveState?: boolean;
  failModels?: boolean;
  failHealth?: boolean;
  failMessages?: boolean;
  failDeviceStatus?: boolean;
  liveConversationState?: ThreadConversationState | null;
  settingsModel?: string;
  includeKimiModel?: boolean;
  quota5hUnavailable?: boolean;
  multiAccount?: boolean;
  conversationState?: ThreadConversationState;
  threads: Array<{
    id: string;
    name?: string;
    preview: string;
    createdAt: number;
    updatedAt: number;
    modelProvider?: string;
    path?: string;
    cwd?: string;
    cliVersion?: string;
    source?: string;
    gitInfo?: {
      branch?: string | null;
      originUrl?: string | null;
      sha?: string | null;
    } | null;
    status?: {
      type: "notLoaded" | "idle" | "systemError" | "active";
      activeFlags?: Array<"waitingOnApproval" | "waitingOnUserInput">;
    };
  }>;
}

function createFetchMock(state: MockState) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/api/auth/session")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          authenticated: state.session.authenticated,
          expiresAt: state.session.expiresAt,
          requiresAuth: state.session.requiresAuth,
          remoteRequest: state.session.remoteRequest,
          debugAvailable: state.session.debugAvailable,
          fullControlAvailable: true
        })
      } as Response;
    }

    if (url.includes("/api/auth/login")) {
      if (method !== "POST") {
        throw new Error("Unexpected method");
      }
      state.session.authenticated = true;
      state.session.expiresAt = "2030-01-01T00:00:00.000Z";
      return {
        ok: true,
        json: async () => ({
          ok: true,
          expiresAt: state.session.expiresAt
        })
      } as Response;
    }

    if (url.includes("/api/auth/logout")) {
      state.session.authenticated = false;
      state.session.expiresAt = null;
      return {
        ok: true,
        json: async () => ({
          ok: true
        })
      } as Response;
    }

    if (url.includes("/api/client-errors") && method === "POST") {
      return {
        ok: true,
        status: 202,
        json: async () => ({ ok: true })
      } as Response;
    }

    if (url.includes("/api/remote/status")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          tailscaleInstalled: true,
          tailscaleIps: ["100.64.0.2"],
          host: "0.0.0.0",
          port: 4311
        })
      } as Response;
    }

    if (url.includes("/api/device/status")) {
      if (state.failDeviceStatus) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ ok: false, error: "Laptop status unavailable" })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          status: {
            machineState: "awake",
            updatedAt: "2030-01-01T10:15:00.000Z",
            battery: { available: true, percent: 73, state: "discharging" },
            acPower: { available: true, connected: false },
            cpuTemperature: { available: true, celsius: 70.4 },
            gpuTemperature: { available: true, celsius: 57 },
            brightness: { available: true, percent: 76 },
            session: { available: true, active: true, locked: false, idle: false }
          }
        })
      } as Response;
    }

    if (url.includes("/messages") && method === "POST") {
      if (state.failMessages) {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            ok: false,
            error: "Desktop IPC is not connected"
          })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ ok: true, threadId: "t", ownerClientId: null })
      } as Response;
    }

    if (url === "/api/threads" && method === "POST") {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          threadId: "thread-created",
          thread: {
            id: "thread-created",
            preview: "",
            createdAt: 3,
            updatedAt: 3,
            cwd: "/workspace/project"
          },
          model: "gpt-5.5",
          cwd: "/workspace/project"
        })
      } as Response;
    }

    if (url.includes("/api/health")) {
      if (state.failHealth) {
        return {
          ok: false,
          json: async () => ({
            ok: false,
            error: "Health unavailable"
          })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          state: {
            appReady: true,
            ipcConnected: true,
            ipcInitialized: true,
            requiresAuth: state.session.requiresAuth,
            multiAccount: state.multiAccount ?? true
          }
        })
      } as Response;
    }

    if (url.includes("/account-status")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          state: "assigned",
          accountNumber: 4,
          accountDisplay: "Account 4 (de***@example.com)",
          maskedEmail: "de***@example.com",
          quota5h: state.quota5hUnavailable
            ? null
            : { remainingPercent: 79, resetAtMs: 1_783_798_873_165 },
          quota7d: { remainingPercent: 96, resetAtMs: 1_784_361_887_165 },
          poolQuota: {
            accountCount: 7,
            fiveHour: null,
            sevenDay: {
              windowMinutes: 10080,
              reportedCount: 7,
              totalRemainingPercent: 412,
              averageRemainingPercent: 58.86,
              earliestResetAtMs: 1_784_487_760_959,
              latestResetAtMs: 1_784_582_025_955
            },
            updatedAt: 1_784_058_257_371
          },
          updatedAt: 1_783_781_435_801,
          stale: false,
          reason: "Saved task assignment"
        })
      } as Response;
    }

    if (url.includes("/api/accounts/resets")) {
      return new Response(JSON.stringify({ ok: true, status: { available: true, availableCount: 3, eligible: false, fiveHourRemaining: 82, weeklyRemaining: 64, reason: null } }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.includes("/api/accounts/status")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          summary: { total: 2, ready: 1, delayed: 1, unavailable: 0 },
          recommendedAccountNumber: 2,
          accounts: [
            {
              accountNumber: 1,
              availability: "delayed",
              current: false,
              riskLevel: "medium",
              waitMs: 60_000,
              reason: "quota cache exhausted"
            },
            {
              accountNumber: 2,
              availability: "ready",
              current: true,
              riskLevel: "low",
              waitMs: 0,
              reason: null
            }
          ]
        })
      } as Response;
    }

    if (url.includes("/settings")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          model: state.settingsModel ?? "gpt-5.5",
          modelProvider: "codex-multi-auth-runtime-proxy",
          reasoningEffort: "high"
        })
      } as Response;
    }

    if (url.includes("/compact") && method === "POST") {
      return {
        ok: true,
        json: async () => ({ ok: true, threadId: "thread-command" })
      } as Response;
    }

    if (url.includes("/edit-last-message") && method === "POST") {
      return {
        ok: true,
        json: async () => ({ ok: true, threadId: "thread-actions" })
      } as Response;
    }

    if (url.includes("/fork") && method === "POST") {
      state.threads.push({
        id: "thread-branch",
        preview: "Branched task",
        createdAt: 3,
        updatedAt: 3,
        cwd: "/workspace/project"
      });
      return {
        ok: true,
        json: async () => ({ ok: true, threadId: "thread-branch" })
      } as Response;
    }

    if (url.includes("/side") && method === "POST") {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          threadId: "side-1",
          title: "Side conversation"
        })
      } as Response;
    }

    if (url.startsWith("/api/threads/side-1?") && method === "GET") {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          thread: { id: "side-1", turns: [], requests: [] }
        })
      } as Response;
    }

    if (
      state.conversationState &&
      /^\/api\/threads\/[^/]+$/.test(url) &&
      method === "GET"
    ) {
      return {
        ok: true,
        json: async () => ({ ok: true, thread: state.conversationState })
      } as Response;
    }

    if (/\/api\/threads\/[^/]+\/queue$/.test(url) && method === "GET") {
      return new Response(JSON.stringify({ ok: true, threadId: state.conversationState?.id ?? "t", ownerClientId: null, messages: [] }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.includes("/live-state")) {
      if (state.failLiveState) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ ok: false, error: "Live refresh failed" })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          threadId: state.conversationState?.id ?? "t",
          ownerClientId: null,
          conversationState: Object.hasOwn(state, "liveConversationState")
            ? state.liveConversationState ?? null
            : state.conversationState ?? null,
          queuedFollowUps: []
        })
      } as Response;
    }

    if (url.includes("/stream-events")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          threadId: state.conversationState?.id ?? "t",
          ownerClientId: null,
          events: []
        })
      } as Response;
    }

    if (url.includes("/api/threads") && !url.includes("/live-state")) {
      if (state.failThreadsWithAuthExpired) {
        return {
          ok: false,
          json: async () => ({
            ok: false,
            error: "Session expired",
            code: "AUTH_EXPIRED"
          })
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: state.threads,
          nextCursor: null,
          pages: 0,
          truncated: false
        })
      } as Response;
    }

    if (url.includes("/api/collaboration-modes")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: [
            {
              name: "Plan",
              mode: "plan",
              model: null,
              reasoning_effort: "medium",
              developer_instructions: "x"
            }
          ]
        })
      } as Response;
    }

    if (url.includes("/api/models")) {
      if (state.failModels) {
        return {
          ok: false,
          json: async () => ({
            ok: false,
            error: "Model catalog unavailable"
          })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: [
            {
              id: "gpt-5.3-codex",
              model: "gpt-5.3-codex",
              upgrade: null,
              displayName: "GPT-5.3 Codex",
              description: "Model",
              supportedReasoningEfforts: [
                {
                  reasoningEffort: "medium",
                  description: "Balanced"
                }
              ],
              defaultReasoningEffort: "medium",
              inputModalities: ["text"],
              supportsPersonality: true,
              isDefault: true,
              hidden: false
            },
            ...(state.includeKimiModel
              ? [
                  {
                    id: "cline-pass/kimi-k3",
                    model: "cline-pass/kimi-k3",
                    upgrade: null,
                    displayName: "Kimi K3 (ClinePass)",
                    description: "Kimi inference through ClinePass",
                    supportedReasoningEfforts: [
                      {
                        reasoningEffort: "high",
                        description: "Deep reasoning"
                      }
                    ],
                    defaultReasoningEffort: "high",
                    inputModalities: ["text", "image"],
                    supportsPersonality: false,
                    isDefault: false,
                    hidden: false
                  }
                ]
              : [])
          ],
          nextCursor: null
        })
      } as Response;
    }

    if (url.includes("/api/debug/trace/status")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          active: null,
          recent: []
        })
      } as Response;
    }

    if (url.includes("/api/debug/history")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          history: []
        })
      } as Response;
    }

    return {
      ok: true,
      json: async () => ({
        ok: true,
        threadId: "t",
        ownerClientId: null,
        conversationState: null,
        events: []
      })
    } as Response;
  });
}

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    MockEventSource.latest = null;
    const storedValues = new Map<string, string>();
    const storage = {
      get length() {
        return storedValues.size;
      },
      getItem: vi.fn((key: string) => storedValues.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storedValues.set(key, value)),
      removeItem: vi.fn((key: string) => storedValues.delete(key)),
      clear: vi.fn(() => storedValues.clear()),
      key: vi.fn((index: number) => [...storedValues.keys()][index] ?? null)
    };
    vi.stubGlobal("localStorage", storage);

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });

    Object.defineProperty(window, "scrollTo", {
      writable: true,
      value: vi.fn()
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });

    class MockResizeObserver {
      public observe(): void {}

      public disconnect(): void {}

      public unobserve(): void {}
    }

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows lock screen when unauthenticated", async () => {
    const state: MockState = {
      session: {
        authenticated: false,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: null
      },
      failThreadsWithAuthExpired: false,
      threads: []
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);
    expect(await screen.findByText("Codex Mobile is locked")).toBeTruthy();
    const password = screen.getByLabelText<HTMLInputElement>("Password");
    expect(password.type).toBe("password");
    expect(password.name).toBe("password");
    expect(password.autocomplete).toBe("current-password");
    expect(password.getAttribute("inputmode")).toBeNull();
    const form = screen.getByRole("form", { name: "Unlock Codex Mobile" });
    expect(form.contains(password)).toBe(true);
    const username = form.querySelector('input[name="username"]');
    expect(username?.getAttribute("autocomplete")).toBe("username");
    expect(username?.getAttribute("value")).toBe("codex-mobile");
  });

  it("unlocks after successful password login using the existing PIN", async () => {
    const state: MockState = {
      session: {
        authenticated: false,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: null
      },
      failThreadsWithAuthExpired: false,
      threads: []
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);
    const pinInput = await screen.findByLabelText("Password");
    fireEvent.change(pinInput, { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Unlock"));

    expect(await screen.findByText("No thread selected")).toBeTruthy();
  });

  it("submits an autofilled password even without an input change event", async () => {
    const state: MockState = {
      session: {
        authenticated: false,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: null
      },
      failThreadsWithAuthExpired: false,
      threads: []
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const password = await screen.findByLabelText<HTMLInputElement>("Password");
    password.value = "12345678";
    fireEvent.submit(screen.getByRole("form", { name: "Unlock Codex Mobile" }));

    expect(await screen.findByText("No thread selected")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ pin: "12345678" })
    }));
  });

  it("uses the Desktop thread name instead of the prompt preview", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-named",
          name: "Desktop generated title",
          preview: "Original prompt preview",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect((await screen.findAllByText("Desktop generated title")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Original prompt preview")).toBeNull();
  });

  it("keeps the CPU monitor visible outside the Environment panel without a selected task", async () => {
    const state: MockState = {
      session: { authenticated: true, requiresAuth: true, remoteRequest: true, debugAvailable: false, expiresAt: "2030-01-01T00:00:00.000Z" },
      failThreadsWithAuthExpired: false,
      threads: []
    };
    vi.stubGlobal("fetch", createFetchMock(state));
    render(<App />);
    await screen.findByText("No thread selected");
    fireEvent.click(screen.getByRole("button", { name: "Environment" }));
    fireEvent.click(screen.getByLabelText("Check CPU every minute"));
    fireEvent.change(screen.getByLabelText("CPU warning temperature"), { target: { value: "85" } });
    fireEvent.click(screen.getByRole("button", { name: "Close environment" }));
    expect(await screen.findByText("CPU 70.4°C")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Environment" })).toBeNull();
    expect(window.localStorage.getItem("farfield.display-preferences.v1")).toContain('"monitorCpuTemperature":true');
    expect(window.localStorage.getItem("farfield.display-preferences.v1")).toContain('"cpuWarningCelsius":85');
  });

  it("does not request debug endpoints when debug is unavailable", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: []
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("No thread selected")).toBeTruthy();

    const traceCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/debug/trace/status")
    );
    const historyCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/debug/history")
    );
    expect(traceCalls.length).toBe(0);
    expect(historyCalls.length).toBe(0);
  });

  it("keeps core chat available when the optional model catalog fails", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      failModels: true,
      threads: []
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect(await screen.findByText("No thread selected")).toBeTruthy();
    expect(await screen.findByText("Systems ready")).toBeTruthy();
  });

  it("keeps the thread list available when health retrieval fails", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      failHealth: true,
      threads: [
        {
          id: "thread-health-independent",
          preview: "Chat remains available",
          createdAt: 1,
          updatedAt: 2
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect(await screen.findAllByText("Chat remains available")).not.toHaveLength(0);
  });

  it("returns to lock screen when auth expires", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: true,
      threads: []
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);
    expect(await screen.findByText("Codex Mobile is locked")).toBeTruthy();
  });

  it("restores the last saved task when the PWA reloads at the root", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        { id: "thread-newest", preview: "Newest", createdAt: 2, updatedAt: 3 },
        { id: "thread-saved", preview: "Saved", createdAt: 1, updatedAt: 2 }
      ]
    };
    window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, "thread-saved");
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/threads/thread-saved");
    });
  });

  it("keeps an explicit task link ahead of the saved task", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        { id: "thread-saved", preview: "Saved", createdAt: 1, updatedAt: 2 },
        { id: "thread-linked", preview: "Linked", createdAt: 2, updatedAt: 3 }
      ]
    };
    window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, "thread-saved");
    window.history.replaceState(null, "", "/threads/thread-linked");
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/threads/thread-linked");
      expect(window.localStorage.getItem(LAST_THREAD_STORAGE_KEY)).toBe("thread-linked");
    });
  });

  it("replaces a missing saved task with the first available task", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        { id: "thread-valid", preview: "Valid", createdAt: 1, updatedAt: 2 }
      ]
    };
    window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, "thread-missing");
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/threads/thread-valid");
      expect(window.localStorage.getItem(LAST_THREAD_STORAGE_KEY)).toBe("thread-valid");
    });
  });

  it("clears a saved task when the loaded task list is empty", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: []
    };
    window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, "thread-missing");
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    await waitFor(() => {
      expect(window.localStorage.getItem(LAST_THREAD_STORAGE_KEY)).toBeNull();
    });
  });

  it("replaces stale selected thread id with first available thread", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-valid",
          preview: "valid thread",
          createdAt: 1,
          updatedAt: 2
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));
    window.history.replaceState(null, "", "/threads/thread-stale");

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/threads/thread-valid");
    });
  });

  it("keeps a newly created empty task selected while it is absent from the thread list", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-existing",
          preview: "Existing task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/threads/thread-existing");

    render(<App />);

    fireEvent.click(await screen.findByLabelText("New thread in project"));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          (call) => String(call[0]).startsWith("/api/threads?")
        ).length
      ).toBeGreaterThanOrEqual(2);
      expect(window.location.pathname).toBe("/threads/thread-created");
    });
  });

  it("starts a projectless chat when the Tasks group is empty", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-existing-project",
          preview: "Existing project chat",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/threads/thread-existing-project");

    render(<App />);

    fireEvent.click(await screen.findByLabelText("New task"));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/threads/thread-created");
    });
    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === "/api/threads" && call[1]?.method === "POST"
    );
    expect(createCall?.[1]?.body).toBe("{}");
    expect(screen.getByLabelText("New task")).toBeTruthy();
  });

  it("shows which tasks are currently running", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-running",
          preview: "Running task",
          createdAt: 2,
          updatedAt: 2,
          cwd: "/workspace/project",
          status: { type: "active", activeFlags: [] }
        },
        {
          id: "thread-finished",
          preview: "Finished task",
          createdAt: 1,
          updatedAt: 1,
          cwd: "/workspace/project",
          status: { type: "notLoaded" }
        }
      ]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByLabelText("Task running: Running task")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.queryByLabelText("Task running: Finished task")).toBeNull();

    fireEvent.click(screen.getByLabelText("Pause thread"));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            String(call[0]).includes("/api/threads/thread-running/interrupt") &&
            (call[1] as RequestInit | undefined)?.method === "POST"
        )
      ).toBe(true);
    });
  });

  it("polls live messages at a backed-off cadence when live events are unavailable", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-auto-refresh",
          preview: "Active Desktop task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project",
          status: { type: "active", activeFlags: [] }
        }
      ],
      conversationState: {
        id: "thread-auto-refresh",
        updatedAt: 1,
        turns: [
          {
            id: "turn-1",
            status: "in-progress",
            items: [
              {
                id: "assistant-1",
                type: "agentMessage",
                text: "Initial progress",
                phase: "commentary"
              }
            ]
          }
        ],
        requests: []
      }
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);
    expect(await screen.findByText("Initial progress")).toBeTruthy();

    const currentConversation = state.conversationState;
    if (!currentConversation) {
      throw new Error("Expected the active conversation fixture");
    }
    state.conversationState = {
      id: currentConversation.id,
      updatedAt: 2,
      turns: [
        {
          id: "turn-1",
          status: "in-progress",
          items: [
            ...(currentConversation.turns[0]?.items ?? []),
            {
              id: "assistant-2",
              type: "agentMessage",
              text: "New Desktop progress",
              phase: "commentary"
            }
          ]
        }
      ],
      requests: []
    };

    expect(
      await screen.findByText("New Desktop progress", undefined, { timeout: 6_500 })
    ).toBeTruthy();
  }, 8_000);

  it("loads a completed response when connected live state stays empty", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-missing-live-state",
        preview: "Accepted task without live state",
        createdAt: 1,
        updatedAt: 1,
        cwd: "/workspace/project",
        status: { type: "active", activeFlags: [] }
      }],
      conversationState: {
        id: "thread-missing-live-state",
        updatedAt: 1,
        turns: [],
        requests: []
      },
      liveConversationState: null
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect((await screen.findAllByText("Accepted task without live state")).length)
      .toBeGreaterThan(0);
    await waitFor(() => expect(MockEventSource.latest).not.toBeNull());
    act(() => {
      MockEventSource.latest?.onopen?.(new Event("open"));
    });

    state.conversationState = {
      id: "thread-missing-live-state",
      updatedAt: 2,
      turns: [{
        id: "turn-complete",
        status: "completed",
        items: [{
          id: "assistant-complete",
          type: "agentMessage",
          text: "Response recovered from durable history",
          phase: "final_answer"
        }]
      }],
      requests: []
    };
    state.threads[0] = {
      ...state.threads[0]!,
      updatedAt: 2,
      status: { type: "idle" }
    };

    expect(
      await screen.findByText("Response recovered from durable history", undefined, {
        timeout: 6_500
      })
    ).toBeTruthy();
    expect(fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/live-state")
    )).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((call) =>
      /^\/api\/threads\/thread-missing-live-state\?includeTurns=true$/.test(String(call[0]))
    )).toHaveLength(2);
  }, 8_000);

  it("does not download debug stream history in the normal chat tab", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-chat-only",
        preview: "Chat without debug traffic",
        createdAt: 1,
        updatedAt: 2,
        cwd: "/workspace/project",
        status: { type: "idle", activeFlags: [] }
      }],
      conversationState: {
        id: "thread-chat-only",
        updatedAt: 1,
        turns: [],
        requests: []
      }
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/live-state")))
        .toBe(true);
    });

    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/stream-events")))
      .toBe(false);
  });

  it("refreshes live output promptly from a named Desktop stream event", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-live-event",
        preview: "Live event task",
        createdAt: 1,
        updatedAt: 2,
        cwd: "/workspace/project",
        status: { type: "active", activeFlags: [] }
      }],
      conversationState: {
        id: "thread-live-event",
        updatedAt: 1,
        turns: [],
        requests: []
      }
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);
    expect((await screen.findAllByText("Live event task")).length).toBeGreaterThan(0);
    state.conversationState = {
      id: "thread-live-event",
      updatedAt: 2,
      turns: [{
        id: "turn-live",
        status: "in-progress",
        items: [{
          id: "assistant-live",
          type: "agentMessage",
          text: "Immediate live progress",
          phase: "commentary"
        }]
      }],
      requests: []
    };

    MockEventSource.latest?.emit(
      "thread-live-state-changed",
      JSON.stringify({ type: "thread-live-state-changed", threadId: "thread-live-event" })
    );

    expect(await screen.findByText("Immediate live progress", undefined, { timeout: 500 }))
      .toBeTruthy();
  });

  it("refreshes missed live output when the event stream reconnects", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{ id: "thread-reconnect", preview: "Reconnect task", createdAt: 1, updatedAt: 1 }],
      conversationState: { id: "thread-reconnect", updatedAt: 1, turns: [], requests: [] }
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await waitFor(() => expect(fetchMock.mock.calls.some((call) =>
      String(call[0]).includes("/live-state")
    )).toBe(true));
    state.conversationState = {
      id: "thread-reconnect", updatedAt: 2, requests: [],
      turns: [{
        id: "turn-reconnect", status: "in-progress",
        items: [{
          id: "message-reconnect", type: "agentMessage",
          text: "Output received while disconnected", phase: "commentary"
        }]
      }]
    };
    act(() => MockEventSource.latest?.onopen?.(new Event("open")));
    expect(await screen.findByText("Output received while disconnected", undefined, {
      timeout: 700
    })).toBeTruthy();
  });

  it("ignores generic IPC history events in the normal chat tab", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-history-event",
        preview: "History event task",
        createdAt: 1,
        updatedAt: 2,
        cwd: "/workspace/project",
        status: { type: "active", activeFlags: [] }
      }],
      conversationState: {
        id: "thread-history-event",
        updatedAt: 1,
        turns: [],
        requests: []
      }
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect((await screen.findAllByText("History event task")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/live-state")))
        .toBe(true);
    });
    const liveStateCallsBefore = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/live-state")
    ).length;

    MockEventSource.latest?.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "history", entry: null })
      })
    );
    await new Promise((resolve) => window.setTimeout(resolve, 900));

    expect(fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/live-state")
    )).toHaveLength(liveStateCallsBefore);
  });

  it("reports a failed named-event refresh without an unhandled rejection", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-live-error",
        preview: "Live event error task",
        createdAt: 1,
        updatedAt: 2,
        cwd: "/workspace/project",
        status: { type: "active", activeFlags: [] }
      }],
      conversationState: {
        id: "thread-live-error",
        updatedAt: 1,
        turns: [],
        requests: []
      }
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);
    expect((await screen.findAllByText("Live event error task")).length).toBeGreaterThan(0);
    state.failLiveState = true;
    MockEventSource.latest?.emit(
      "thread-live-state-changed",
      JSON.stringify({ type: "thread-live-state-changed", threadId: "thread-live-error" })
    );

    expect(await screen.findByText("Live refresh failed", undefined, { timeout: 500 }))
      .toBeTruthy();
  });

  it("keeps only the latest thinking title and summarizes completed hidden thinking", async () => {
    const storage = window.localStorage as Storage;
    vi.mocked(storage.getItem).mockImplementation((key: string) =>
      key === "farfield.display-preferences.v1"
        ? JSON.stringify({ showReasoning: false, showDiffs: true })
        : null
    );
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-thinking-summary",
          preview: "Thinking summary task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project",
          status: { type: "active", activeFlags: [] }
        }
      ],
      conversationState: {
        id: "thread-thinking-summary",
        turns: [
          {
            id: "turn-thinking-summary",
            status: "completed",
            items: [
              {
                id: "reasoning-completed",
                type: "reasoning",
                summary: ["Private completed title"]
              },
              {
                id: "assistant-progress",
                type: "agentMessage",
                text: "Progress update",
                phase: "commentary"
              },
              {
                id: "command-read",
                type: "commandExecution",
                command: "sed -n '1,80p' src/file.ts",
                status: "completed",
                commandActions: [{ type: "read", path: "src/file.ts" }]
              },
              {
                id: "change-1",
                type: "fileChange",
                status: "completed",
                changes: [
                  {
                    path: "src/file.ts",
                    kind: { type: "update" },
                    diff: "-old\n+new"
                  }
                ]
              },
              {
                id: "command-test",
                type: "commandExecution",
                command: "pnpm test",
                status: "completed"
              },
              {
                id: "reasoning-live",
                type: "reasoning",
                summary: ["Checking live service"]
              },
              {
                id: "assistant-live-progress",
                type: "agentMessage",
                text: "Checking the deployed service now.",
                phase: "commentary"
              },
              {
                id: "command-live",
                type: "commandExecution",
                command: "systemctl --user status codex-mobile.service",
                status: "inProgress"
              }
            ]
          }
        ],
        requests: []
      }
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect(await screen.findByText("Checking live service")).toBeTruthy();
    const progress = screen.getByText("Progress update");
    const activitySummary = screen.getByText("Edited files, read files, ran commands");
    expect(
      progress.compareDocumentPosition(activitySummary) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText("Private completed title")).toBeNull();
  });

  it("does not show a late response from the previously selected task", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-a",
          preview: "Task A",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        },
        {
          id: "thread-b",
          preview: "Task B",
          createdAt: 1,
          updatedAt: 1,
          cwd: "/workspace/project"
        }
      ],
      conversationState: {
        id: "thread-a",
        updatedAt: 1,
        turns: [
          {
            id: "turn-a",
            status: "completed",
            items: [
              {
                id: "assistant-a",
                type: "agentMessage",
                text: "Task A initial response",
                phase: "final_answer"
              }
            ]
          }
        ],
        requests: []
      }
    };
    const baseFetch = createFetchMock(state);
    let resolveLateLiveState!: (response: Response) => void;
    const lateLiveState = new Promise<Response>((resolve) => {
      resolveLateLiveState = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/threads/thread-a/live-state")) {
        return lateLiveState;
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("Task A initial response")).toBeTruthy();

    state.conversationState = {
      id: "thread-b",
      updatedAt: 2,
      turns: [
        {
          id: "turn-b",
          status: "completed",
          items: [
            {
              id: "assistant-b",
              type: "agentMessage",
              text: "Task B response",
              phase: "final_answer"
            }
          ]
        }
      ],
      requests: []
    };
    const taskBButton = screen.getByText("Task B").closest("button");
    if (!taskBButton) {
      throw new Error("Expected Task B sidebar button");
    }
    fireEvent.click(taskBButton);
    expect(await screen.findByText("Task B response")).toBeTruthy();

    await act(async () => {
      resolveLateLiveState({
        ok: true,
        json: async () => ({
          ok: true,
          threadId: "thread-a",
          ownerClientId: null,
          conversationState: {
            id: "thread-a",
            updatedAt: 99,
            turns: [
              {
                id: "turn-a-late",
                status: "completed",
                items: [
                  {
                    id: "assistant-a-late",
                    type: "agentMessage",
                    text: "Late Task A response",
                    phase: "final_answer"
                  }
                ]
              }
            ],
            requests: []
          }
        })
      } as Response);
      await lateLiveState;
    });

    await waitFor(() => {
      expect(screen.queryByText("Late Task A response")).toBeNull();
      expect(screen.getByText("Task B response")).toBeTruthy();
    });
  });

  it("shows the selected default model name instead of a blank trigger", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      settingsModel: "gpt-5.3-codex",
      threads: [
        {
          id: "thread-default-model",
          preview: "Default model task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect(await screen.findByText("GPT-5.3 Codex (gpt-5.3-codex)")).toBeTruthy();
  });

  it("shows an advertised ClinePass Kimi model without a hard-coded frontend entry", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      settingsModel: "cline-pass/kimi-k3",
      includeKimiModel: true,
      threads: [
        {
          id: "thread-kimi-model",
          preview: "Kimi model task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect(
      await screen.findByText("Kimi K3 (ClinePass) (cline-pass/kimi-k3)")
    ).toBeTruthy();
  });

  it("keeps the latest timed final answer visible above the worked duration", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-final-summary",
          preview: "Final summary task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project",
          status: { type: "active", activeFlags: [] }
        }
      ],
      conversationState: {
        id: "thread-final-summary",
        updatedAt: 1_780_000_120,
        turns: [
          {
            id: "turn-old",
            status: "completed",
            items: [
              {
                id: "assistant-old",
                type: "agentMessage",
                text: "Earlier response remains visible",
                phase: "final_answer"
              }
            ]
          },
          {
            id: "turn-latest",
            status: "completed",
            startedAt: 1_780_000_000,
            completedAt: 1_780_000_120,
            durationMs: 120_000,
            items: [
              {
                id: "assistant-latest",
                type: "agentMessage",
                text: "Latest final summary remains visible",
                phase: "final_answer"
              }
            ]
          }
        ],
        requests: []
      }
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect(await screen.findByText("Earlier response remains visible")).toBeTruthy();
    expect(await screen.findByText("Latest final summary remains visible")).toBeTruthy();
    expect(screen.getByText("Worked for 2m 0s")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Worked for 2m 0s" })).toBeNull();
  });

  it("shows the live working duration from native turn timing fields", async () => {
    vi.setSystemTime(1_780_000_125_000);
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-live-duration",
          preview: "Live duration task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project",
          status: { type: "active", activeFlags: [] }
        }
      ],
      conversationState: {
        id: "thread-live-duration",
        updatedAt: 1_780_000_125,
        turns: [
          {
            id: "turn-live",
            status: "interrupted",
            startedAt: 1_780_000_000,
            completedAt: null,
            durationMs: null,
            items: [
              {
                id: "assistant-live",
                type: "agentMessage",
                text: "Current progress",
                phase: "commentary"
              }
            ]
          }
        ],
        requests: []
      }
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect(await screen.findByText("Working for 2m 5s")).toBeTruthy();
  });

  it("opens the selected task environment from the header", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-environment",
          preview: "Environment task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project",
          gitInfo: { branch: "feature/mobile-panel" }
        }
      ],
      conversationState: {
        id: "thread-environment",
        turns: [
          {
            id: "turn-environment",
            status: "completed",
            items: [
              {
                id: "change-environment",
                type: "fileChange",
                status: "completed",
                changes: [
                  {
                    path: "src/app.ts",
                    kind: { type: "update" },
                    diff: "-old\n+new\n+extra"
                  }
                ]
              }
            ]
          }
        ],
        requests: []
      }
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const environmentButton = await screen.findByRole("button", { name: "Environment" });
    fireEvent.click(environmentButton);
    const environmentDialog = screen.getByRole("dialog", { name: "Environment" });
    expect(within(environmentDialog).getByText("feature/mobile-panel")).toBeTruthy();
    expect(within(environmentDialog).getByText("1 file changed")).toBeTruthy();
    expect(within(environmentDialog).getByText("+2")).toBeTruthy();
    expect(within(environmentDialog).getByText("−1")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/device/status", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
  });

  it("shows the authoritative model for a routed thread", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-sol",
          preview: "Sol routed task",
          createdAt: 1,
          updatedAt: 2,
          modelProvider: "codex-multi-auth-runtime-proxy",
          cwd: "/workspace/project"
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    expect(await screen.findByText("gpt-5.5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All account statuses" })).toBeTruthy();
    const displaySettings = screen.getByRole("button", { name: "Display settings" });
    displaySettings.focus();
    fireEvent.keyDown(displaySettings, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("Hide commands")).toBeTruthy();
    expect(screen.queryByText("Lock")).toBeNull();
  });

  it("opens structured /status without sending model text", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      quota5hUnavailable: true,
      threads: [
        {
          id: "thread-command",
          preview: "Command task",
          createdAt: 1,
          updatedAt: 2,
          modelProvider: "codex-multi-auth-runtime-proxy",
          cwd: "/workspace/project",
          status: { type: "active", activeFlags: [] }
        }
      ]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const composer = await screen.findByPlaceholderText("Ask for follow-up changes");
    fireEvent.change(composer, { target: { value: "/status" } });
    fireEvent.click(screen.getByLabelText("Queue follow-up"));

    expect(await screen.findByRole("dialog", { name: "Task status" })).toBeTruthy();
    expect(screen.getByText("codex-multi-auth-runtime-proxy")).toBeTruthy();
    expect(screen.getByText("Account 4 (de***@example.com)")).toBeTruthy();
    expect(screen.getByText("96% remaining (7d)")).toBeTruthy();
    expect(screen.queryByText("Not reported")).toBeNull();
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          String(call[0]).includes("/messages") &&
          (call[1] as RequestInit | undefined)?.method === "POST"
      )
    ).toBe(false);
  });

  it("keeps a message draft when delivery fails", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      failMessages: true,
      threads: [
        {
          id: "thread-send-failure",
          preview: "Running task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project",
          status: { type: "active", activeFlags: [] }
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    const composer = await screen.findByPlaceholderText("Ask for follow-up changes");
    fireEvent.change(composer, { target: { value: "Hi" } });
    fireEvent.click(screen.getByLabelText("Queue follow-up"));

    await screen.findByText("Desktop IPC is not connected");
    expect((composer as HTMLTextAreaElement).value).toBe("Hi");
  });

  it("clears the in-memory PWA draft after successful delivery", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-send-success",
        preview: "Running task",
        createdAt: 1,
        updatedAt: 2,
        cwd: "/workspace/project",
        status: { type: "active", activeFlags: [] }
      }]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    const composer = await screen.findByPlaceholderText("Ask for follow-up changes");
    fireEvent.change(composer, { target: { value: "Hi" } });
    fireEvent.click(screen.getByLabelText("Queue follow-up"));

    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(""));
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
      expect.stringContaining("farfield:composer-draft:"),
      expect.any(String)
    );
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/draft"))).toBe(false);
  });

  it("sends the selected task working directory with a message", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-message-cwd",
        preview: "Running task",
        createdAt: 1,
        updatedAt: 2,
        cwd: "/workspace/project",
        status: { type: "active", activeFlags: [] }
      }]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    const composer = await screen.findByPlaceholderText("Ask for follow-up changes");
    fireEvent.change(composer, { target: { value: "Use the current project" } });
    fireEvent.click(screen.getByLabelText("Queue follow-up"));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        (call) => String(call[0]).includes("/messages")
      );
      expect(request).toBeTruthy();
      expect(JSON.parse(String((request?.[1] as RequestInit | undefined)?.body))).toMatchObject({
        cwd: "/workspace/project",
        text: "Use the current project"
      });
    });
  });

  it("shows the received message before thread history refresh finishes", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-receipt",
        preview: "Running task",
        createdAt: 1,
        updatedAt: 2,
        cwd: "/workspace/project",
        status: { type: "active", activeFlags: [] }
      }]
    };
    const baseFetch = createFetchMock(state);
    let messageReceived = false;
    const pendingThreadList = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (messageReceived && url.startsWith("/api/threads?") && method === "GET") {
        return pendingThreadList;
      }
      const response = await baseFetch(input, init);
      if (url.includes("/messages") && method === "POST" && response.ok) {
        messageReceived = true;
      }
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    const composer = await screen.findByPlaceholderText("Ask for follow-up changes");
    fireEvent.change(composer, { target: { value: "Safe to close now" } });
    fireEvent.click(screen.getByLabelText("Queue follow-up"));

    expect(await screen.findByText("Safe to close now")).toBeTruthy();
    expect(screen.getByText("Received")).toBeTruthy();
    expect((composer as HTMLTextAreaElement).value).toBe("");
  });

  it("replaces the received bubble when live history includes the message", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [{
        id: "thread-reconciled-receipt",
        preview: "Running task",
        createdAt: 1,
        updatedAt: 2,
        cwd: "/workspace/project",
        status: { type: "active", activeFlags: [] }
      }],
      conversationState: {
        id: "thread-reconciled-receipt",
        updatedAt: 1,
        turns: [],
        requests: []
      }
    };
    vi.stubGlobal("fetch", createFetchMock(state));
    render(<App />);

    const composer = await screen.findByPlaceholderText("Ask for follow-up changes");
    fireEvent.change(composer, { target: { value: "One visible message" } });
    fireEvent.click(screen.getByLabelText("Queue follow-up"));
    expect(await screen.findByText("Received")).toBeTruthy();

    state.conversationState = {
      id: "thread-reconciled-receipt",
      updatedAt: 2,
      turns: [{
        id: "turn-received",
        status: "in-progress",
        items: [{
          id: "user-received",
          type: "userMessage",
          content: [{ type: "text", text: "One visible message" }]
        }]
      }],
      requests: []
    };
    MockEventSource.latest?.emit(
      "thread-live-state-changed",
      JSON.stringify({
        type: "thread-live-state-changed",
        threadId: "thread-reconciled-receipt"
      })
    );

    await waitFor(() => {
      expect(screen.getAllByText("One visible message")).toHaveLength(1);
      expect(screen.queryByText("Received")).toBeNull();
    });
  });

  it("keeps the current PWA draft in memory without persisting or syncing it", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-draft",
          preview: "Draft task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const composer = await screen.findByPlaceholderText("Message Codex…");
    expect((composer as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(composer, { target: { value: "edited on mobile" } });

    expect((composer as HTMLTextAreaElement).value).toBe("edited on mobile");
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
      expect.stringContaining("farfield:composer-draft:"),
      expect.any(String)
    );
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/draft"))).toBe(false);
  });

  it("discards an unsent draft when switching tasks", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-draft-a",
          preview: "Draft task A",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project-a"
        },
        {
          id: "thread-draft-b",
          preview: "Draft task B",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project-b"
        }
      ]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const composer = await screen.findByPlaceholderText("Message Codex…");
    fireEvent.change(composer, { target: { value: "save before switching" } });
    fireEvent.click(screen.getByText("Draft task B"));
    const secondComposer = await screen.findByPlaceholderText("Message Codex…");
    fireEvent.change(secondComposer, { target: { value: "second task draft" } });
    fireEvent.click(screen.getByText("Draft task A"));

    await waitFor(() => {
      expect((screen.getByPlaceholderText("Message Codex…") as HTMLTextAreaElement).value)
        .toBe("");
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/draft"))).toBe(false);
  });

  it("shows a dedicated connection page without exposing the server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Internal server error");
    }));

    render(<App />);

    expect(await screen.findByText("Codex Mobile is offline")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh connection" })).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Check automatically every 10 seconds" })
    ).toBeTruthy();
  });

  it("persists and runs the optional ten-second connection check", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      throw new Error("Backend unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByText("Codex Mobile is offline");

    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Check automatically every 10 seconds" })
    );

    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      "farfield.connection-auto-retry.v1",
      "enabled"
    );
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/auth/session"))
    ).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/auth/session"))
    ).toHaveLength(2);
  });

  it("confirms /compact before starting native compaction", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-command",
          preview: "Command task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const composer = await screen.findByPlaceholderText("Message Codex…");
    fireEvent.change(composer, { target: { value: "/compact" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(await screen.findByRole("dialog", { name: "Compact task" })).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/compact"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Compact task" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            String(call[0]).includes("/compact") &&
            (call[1] as RequestInit | undefined)?.method === "POST"
        )
      ).toBe(true);
    });
    expect(await screen.findByText("Compaction started")).toBeTruthy();
  });

  it("edits, copies, and branches shared conversation messages", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-actions",
          preview: "Action task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ],
      conversationState: {
        id: "thread-actions",
        turns: [
          {
            id: "turn-6",
            status: "completed",
            items: [
              {
                id: "user-6",
                type: "userMessage",
                content: [{ type: "text", text: "Older query" }]
              },
              {
                id: "assistant-6",
                type: "agentMessage",
                text: "Older response",
                phase: "final_answer"
              }
            ]
          },
          {
            id: "turn-7",
            status: "completed",
            items: [
              {
                id: "user-7",
                type: "userMessage",
                content: [{ type: "text", text: "Latest query" }]
              },
              {
                id: "assistant-7",
                type: "agentMessage",
                text: "Latest response",
                phase: "final_answer"
              }
            ]
          }
        ],
        requests: []
      }
    };
    const fetchMock = createFetchMock(state);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("Latest response")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit message" })).toHaveLength(1);

    const copyButtons = screen.getAllByRole("button", { name: "Copy message" });
    fireEvent.click(copyButtons[2]!);
    fireEvent.click(copyButtons[3]!);
    expect(writeText).toHaveBeenCalledWith("Latest query");
    expect(writeText).toHaveBeenCalledWith("Latest response");

    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit message text" }), {
      target: { value: "Revised latest query" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    await waitFor(() => {
      const editCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes("/edit-last-message")
      );
      expect(editCall?.[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(String((editCall?.[1] as RequestInit).body))).toEqual({
        turnId: "turn-7",
        message: "Revised latest query"
      });
    });

    const branchButtons = screen.getAllByRole("button", { name: "Branch response" });
    fireEvent.click(branchButtons[branchButtons.length - 1]!);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/threads/thread-branch");
    });
  });

  it("opens /side without changing or adding to the parent task list", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-parent",
          preview: "Parent task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/project"
        }
      ],
      conversationState: {
        id: "thread-parent",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "Parent question" }]
              },
              {
                id: "assistant-1",
                type: "agentMessage",
                text: "Parent response",
                phase: "final_answer"
              }
            ]
          }
        ],
        requests: []
      }
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);
    expect(await screen.findByText("Parent response")).toBeTruthy();
    const composer = screen.getByPlaceholderText("Message Codex…");
    fireEvent.change(composer, { target: { value: "/side" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(
      await screen.findByRole("dialog", { name: "Temporary side conversation" })
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/threads/thread-parent");
    expect(screen.queryByLabelText("Chat actions: Side conversation")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close side conversation" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Temporary side conversation" })).toBeNull();
    });
    expect(window.location.pathname).toBe("/threads/thread-parent");
  });

  it("compacts large project histories behind a show more control", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: Array.from({ length: 7 }, (_, index) => ({
        id: `thread-${String(index + 1)}`,
        preview: `Project task ${String(index + 1)}`,
        createdAt: 10 - index,
        updatedAt: 10 - index,
        cwd: "/workspace/large-project"
      }))
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Project task 1").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Project task 5")).toBeTruthy();
    expect(screen.queryByText("Project task 6")).toBeNull();
    expect(screen.queryByText("Project task 7")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more (2)" }));

    expect(await screen.findByText("Project task 6")).toBeTruthy();
    expect(screen.getByText("Project task 7")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("keeps queued messages visible when an older queue refresh finishes late", async () => {
    const state: MockState = {
      session: { authenticated: true, requiresAuth: true, remoteRequest: true,
        debugAvailable: false, expiresAt: "2030-01-01T00:00:00.000Z" },
      failThreadsWithAuthExpired: false,
      threads: [{ id: "queue-thread", preview: "Queue test", createdAt: 1, updatedAt: 2 }],
      conversationState: { id: "queue-thread", turns: [{ id: "turn", status: "completed",
        items: [{ id: "answer", type: "agentMessage", text: "Queue view", phase: "final_answer" }] }], requests: [] }
    };
    const baseFetch = createFetchMock(state);
    let resolveOlder!: (response: Response) => void;
    const older = new Promise<Response>(resolve => { resolveOlder = resolve; });
    let liveCalls = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/queue-thread/queue")) {
        liveCalls += 1;
        if (liveCalls === 1) return older;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, threadId: "queue-thread",
          ownerClientId: "desktop",
          messages: [{ id: "pending", text: "Keep this queued message", createdAt: 3 }] }),
          { headers: { "Content-Type": "application/json" } }));
      }
      return baseFetch(input, init);
    }));
    render(<App />);
    await screen.findByText("Queue view");
    await waitFor(() => expect(MockEventSource.latest).not.toBeNull());
    act(() => MockEventSource.latest?.emit("thread-live-state-changed",
      JSON.stringify({ type: "thread-live-state-changed", threadId: "queue-thread" })));
    await screen.findByText("Keep this queued message");
    await act(async () => resolveOlder(new Response(JSON.stringify({ ok: true,
      threadId: "queue-thread", ownerClientId: "desktop", messages: [] }),
      { headers: { "Content-Type": "application/json" } })));
    expect(screen.getByText("Keep this queued message")).toBeTruthy();
  });

  it("marks exactly one chat as current when switching sidebar selection", async () => {
    const state: MockState = {
      session: { authenticated: true, requiresAuth: true, remoteRequest: true,
        debugAvailable: false, expiresAt: "2030-01-01T00:00:00.000Z" },
      failThreadsWithAuthExpired: false,
      threads: [
        { id: "first", preview: "First selectable chat", createdAt: 1, updatedAt: 3, cwd: "/workspace/project" },
        { id: "second", preview: "Second selectable chat", createdAt: 1, updatedAt: 2, cwd: "/workspace/project" }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));
    render(<App />);
    const sidebar = (await screen.findByLabelText("Hide sidebar")).closest("aside");
    if (!sidebar) throw new Error("Desktop sidebar was not rendered");
    await waitFor(() => expect(sidebar.querySelectorAll('[aria-current="page"]')).toHaveLength(1));
    expect(sidebar.querySelector('[aria-current="page"]')?.textContent).toContain("First selectable chat");
    fireEvent.click(within(sidebar).getByRole("button", { name: /^Second selectable chat/ }));
    expect(sidebar.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(sidebar.querySelector('[aria-current="page"]')?.textContent).toContain("Second selectable chat");
  });

  it("orders chats inside a project by most recent activity", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-oldest",
          preview: "Oldest chat",
          createdAt: 1,
          updatedAt: 10,
          cwd: "/workspace/time-order"
        },
        {
          id: "thread-newest",
          preview: "Newest chat",
          createdAt: 3,
          updatedAt: 30,
          cwd: "/workspace/time-order"
        },
        {
          id: "thread-middle",
          preview: "Middle chat",
          createdAt: 2,
          updatedAt: 20,
          cwd: "/workspace/time-order"
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    const desktopSidebar = (await screen.findByLabelText("Hide sidebar")).closest("aside");
    if (!desktopSidebar) {
      throw new Error("Desktop sidebar was not rendered");
    }
    const chatActions = within(desktopSidebar)
      .getAllByLabelText(/^Chat actions:/)
      .map((element) => element.getAttribute("aria-label"));

    expect(chatActions).toEqual([
      "Chat actions: Newest chat",
      "Chat actions: Middle chat",
      "Chat actions: Oldest chat"
    ]);
  });

  it("restores account lists and router status requests when enabled", async () => {
    const state: MockState = {
      session: { authenticated: true, requiresAuth: true, remoteRequest: true,
        debugAvailable: false, expiresAt: "2030-01-01T00:00:00.000Z" },
      failThreadsWithAuthExpired: false, multiAccount: true,
      threads: [{ id: "multi-account", preview: "Multiple accounts task", createdAt: 1, updatedAt: 2 }]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "All account statuses" }));
    const dialog = await screen.findByRole("dialog", { name: "Account status" });
    await within(dialog).findByText("Account 1");
    expect(within(dialog).getByText("Account 2")).toBeTruthy();
    expect(within(dialog).getByText("1 ready · 2 total")).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/account-status"))).toBe(true));
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/accounts/status")).toBe(true);
  });

  it("hides multi-account UI and makes no router status requests when disabled", async () => {
    const state: MockState = {
      session: { authenticated: true, requiresAuth: true, remoteRequest: true,
        debugAvailable: false, expiresAt: "2030-01-01T00:00:00.000Z" },
      failThreadsWithAuthExpired: false, multiAccount: false,
      threads: [{ id: "single-account", preview: "Single account task", createdAt: 1, updatedAt: 2 }]
    };
    const fetchMock = createFetchMock(state);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findAllByText("Single account task");
    fireEvent.click(screen.getAllByRole("button", { name: "Usage and resets" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Usage and resets" });
    await within(dialog).findByText("3 resets available");
    expect(within(dialog).getByText(/5-hour remaining: 82%/)).toBeTruthy();
    expect(within(dialog).queryByText(/Account [0-9]/)).toBeNull();
    expect(screen.queryByRole("button", { name: "All account statuses" })).toBeNull();
    expect(screen.queryByText("Account unavailable")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => /account-status|accounts\/status/.test(String(url)))).toHaveLength(0);
  });

  it("renders the combined quota once inside the desktop sidebar footer", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: [
        {
          id: "thread-quota-footer",
          preview: "Quota footer task",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/workspace/quota-footer"
        }
      ]
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    const desktopSidebar = (await screen.findByLabelText("Hide sidebar")).closest("aside");
    if (!desktopSidebar) {
      throw new Error("Desktop sidebar was not rendered");
    }
    expect(
      await within(desktopSidebar).findByRole("button", {
        name: "59% quota across 7 accounts"
      })
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "59% quota across 7 accounts" })
    ).toHaveLength(1);
  });

  it("keeps an older selected project task visible while compact", async () => {
    const state: MockState = {
      session: {
        authenticated: true,
        requiresAuth: true,
        remoteRequest: true,
        debugAvailable: false,
        expiresAt: "2030-01-01T00:00:00.000Z"
      },
      failThreadsWithAuthExpired: false,
      threads: Array.from({ length: 7 }, (_, index) => ({
        id: `thread-${String(index + 1)}`,
        preview: `Project task ${String(index + 1)}`,
        createdAt: 10 - index,
        updatedAt: 10 - index,
        cwd: "/workspace/large-project"
      }))
    };
    vi.stubGlobal("fetch", createFetchMock(state));

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("Project task 1").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Show more (2)" }));
    fireEvent.click(await screen.findByText("Project task 7"));
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(screen.getAllByText("Project task 7").length).toBeGreaterThan(0);
    expect(screen.getByText("Project task 4")).toBeTruthy();
    expect(screen.queryByText("Project task 5")).toBeNull();
    expect(screen.queryByText("Project task 6")).toBeNull();
    expect(screen.getByRole("button", { name: "Show more (2)" })).toBeTruthy();
  });
});
