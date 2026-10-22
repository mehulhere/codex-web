import { describe, expect, it, vi } from "vitest";
import {
  executeCompactThread,
  executeEditLastMessage,
  executeForkThread,
  executeSideThread
} from "../src/thread-actions.js";

describe("thread actions", () => {
  it("routes Desktop-owned Compact and Edit through follower IPC", async () => {
    const service = {
      compactThread: vi.fn().mockResolvedValue(undefined),
      editLastUserMessage: vi.fn().mockResolvedValue(undefined),
      openSideThread: vi.fn()
    };
    const appClient = {
      compactThread: vi.fn(),
      readThread: vi.fn(),
      rollbackThread: vi.fn(),
      startTurnWithInput: vi.fn(),
      forkThread: vi.fn(),
      injectThreadItems: vi.fn()
    };
    const delivery = { type: "desktop" as const, ownerClientId: "client-1" };

    await executeCompactThread({ threadId: "thread-1", delivery, service, appClient });
    await executeEditLastMessage({
      threadId: "thread-1",
      turnId: "turn-7",
      message: "revised",
      delivery,
      service,
      appClient
    });

    expect(service.compactThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      ownerClientId: "client-1"
    });
    expect(service.editLastUserMessage).toHaveBeenCalledWith({
      threadId: "thread-1",
      ownerClientId: "client-1",
      turnId: "turn-7",
      message: "revised"
    });
    expect(appClient.compactThread).not.toHaveBeenCalled();
  });

  it("routes app-server-owned Compact and Edit directly", async () => {
    const service = {
      compactThread: vi.fn(),
      editLastUserMessage: vi.fn(),
      openSideThread: vi.fn()
    };
    const appClient = {
      compactThread: vi.fn().mockResolvedValue(undefined),
      readThread: vi.fn().mockResolvedValue({
        thread: {
          id: "thread-1",
          turns: [
            {
              id: "turn-7",
              status: "completed",
              params: {
                threadId: "thread-1",
                input: [{ type: "text", text: "original" }]
              },
              items: []
            }
          ],
          requests: []
        }
      }),
      rollbackThread: vi.fn().mockResolvedValue({}),
      startTurnWithInput: vi.fn().mockResolvedValue(undefined),
      forkThread: vi.fn(),
      injectThreadItems: vi.fn()
    };
    const delivery = { type: "app-server" as const };

    await executeCompactThread({ threadId: "thread-1", delivery, service, appClient });
    await executeEditLastMessage({
      threadId: "thread-1",
      turnId: "turn-7",
      message: "revised",
      delivery,
      service,
      appClient
    });

    expect(appClient.compactThread).toHaveBeenCalledWith("thread-1");
    expect(appClient.rollbackThread).toHaveBeenCalledWith("thread-1", 1);
    expect(appClient.startTurnWithInput).toHaveBeenCalledWith(
      "thread-1",
      [{ type: "text", text: "revised" }],
      []
    );
    expect(service.compactThread).not.toHaveBeenCalled();
  });

  it("creates one shared side task through the current owner", async () => {
    const service = {
      compactThread: vi.fn(),
      editLastUserMessage: vi.fn(),
      openSideThread: vi.fn().mockResolvedValue("side-desktop")
    };
    const appClient = {
      compactThread: vi.fn(),
      readThread: vi.fn(),
      rollbackThread: vi.fn(),
      startTurnWithInput: vi.fn(),
      forkThread: vi.fn().mockResolvedValue({ thread: { id: "side-app" } }),
      injectThreadItems: vi.fn().mockResolvedValue(undefined)
    };

    await expect(
      executeSideThread({
        threadId: "thread-1",
        cwd: "/workspace",
        delivery: { type: "desktop", ownerClientId: "client-1" },
        service,
        appClient
      })
    ).resolves.toEqual({ threadId: "side-desktop", title: "Side conversation" });

    await expect(
      executeSideThread({
        threadId: "thread-2",
        cwd: "/workspace",
        delivery: { type: "app-server" },
        service,
        appClient
      })
    ).resolves.toEqual({ threadId: "side-app", title: "Side conversation" });
  });

  it("branches through the selected completed assistant turn", async () => {
    const appClient = {
      forkThread: vi.fn().mockResolvedValue({ thread: { id: "branch-1" } })
    };

    await expect(
      executeForkThread({ threadId: "thread-1", turnId: "turn-7", appClient })
    ).resolves.toBe("branch-1");
    expect(appClient.forkThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      lastTurnId: "turn-7",
      excludeTurns: true
    });
  });
});
