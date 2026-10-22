import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthSession, getDeviceStatus, getHealth, listThreads } from "../src/lib/api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser API", () => {
  it("preserves saved project names from the sidebar API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      data: [{ id: "named", preview: "Chat", createdAt: 1, updatedAt: 2, sidebar: {
        isPinned: false, isProjectPinned: false, isProjectless: false,
        projectPath: "/workspace/folder", projectName: "My Studio", projectOrder: 0, hasUnreadTurn: false
      } }], nextCursor: null
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await listThreads({ limit: 80, archived: false, all: true, maxPages: 20 });
    expect(result.data[0]?.sidebar.projectName).toBe("My Studio");
    expect(result.data[0]?.sidebar.projectPath).toBe("/workspace/folder");
  });

  it("aborts a stalled initial session request after the configured timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })
    ));

    await expect(getAuthSession({ timeoutMs: 5 })).rejects.toThrow();
  });

  it("loads and strictly parses authenticated laptop status", async () => {
    const response = {
      ok: true,
      status: {
        updatedAt: "2026-08-01T00:00:00.000Z",
        machineState: "awake",
        battery: { available: true, percent: 73, state: "discharging" },
        acPower: { available: true, connected: false },
        cpuTemperature: { available: true, celsius: 70.4 },
        gpuTemperature: { available: true, celsius: 57 },
        brightness: { available: true, percent: 76 },
        session: { available: true, active: true, locked: false, idle: false }
      }
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDeviceStatus()).resolves.toEqual(response.status);
    expect(fetchMock).toHaveBeenCalledWith("/api/device/status", undefined);
  });

  it("reports an empty gateway response as an HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502, statusText: "Bad Gateway" }))
    );

    await expect(getHealth()).rejects.toThrow("HTTP 502 Bad Gateway");
  });
});
