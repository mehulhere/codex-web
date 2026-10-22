import { describe, expect, it } from "vitest";
import {
  applyDesktopOwnershipEvidence,
  interruptDeliveryUnavailableReason,
  composerMessageDeliveryUnavailableReason,
  messageDeliveryUnavailableReason,
  resolveComposerMessageDelivery,
  resolveInterruptDelivery,
  resolveMessageDelivery,
  resolveOwnerClientId,
  resolveSideMessageDelivery
} from "../src/thread-owner.js";

describe("applyDesktopOwnershipEvidence", () => {
  it("does not transfer a Mobile-created task when Desktop only mirrors its draft", () => {
    const owners = new Map<string, string>();
    const appServerOwnedThreadIds = new Set(["thread-mobile"]);

    applyDesktopOwnershipEvidence(
      owners,
      appServerOwnedThreadIds,
      "thread-mobile",
      "desktop-client",
      "composer-draft"
    );

    expect(owners.has("thread-mobile")).toBe(false);
    expect(appServerOwnedThreadIds.has("thread-mobile")).toBe(true);
  });

  it("transfers ownership when Desktop publishes the task stream", () => {
    const owners = new Map<string, string>();
    const appServerOwnedThreadIds = new Set(["thread-mobile"]);

    applyDesktopOwnershipEvidence(
      owners,
      appServerOwnedThreadIds,
      "thread-mobile",
      "desktop-client",
      "thread-stream"
    );

    expect(owners.get("thread-mobile")).toBe("desktop-client");
    expect(appServerOwnedThreadIds.has("thread-mobile")).toBe(false);
  });
});

describe("resolveOwnerClientId", () => {
  it("uses mapped owner when both mapped owner and override are present", () => {
    const owners = new Map<string, string>();
    owners.set("thread-1", "client-map");

    const owner = resolveOwnerClientId(owners, "thread-1", "client-override");
    expect(owner).toBe("client-map");
  });

  it("uses explicit override when mapped owner is missing", () => {
    const owner = resolveOwnerClientId(new Map(), "thread-1", "client-override");
    expect(owner).toBe("client-override");
  });

  it("uses mapped owner when override missing", () => {
    const owners = new Map<string, string>();
    owners.set("thread-1", "client-map");

    const owner = resolveOwnerClientId(owners, "thread-1");
    expect(owner).toBe("client-map");
  });

  it("throws when owner is unavailable", () => {
    expect(() => resolveOwnerClientId(new Map(), "thread-1")).toThrowError(
      /No owner client id/
    );
  });
});

describe("resolveMessageDelivery", () => {
  it("uses the Desktop owner when the task has one", () => {
    const owners = new Map([["thread-1", "client-desktop"]]);

    expect(
      resolveMessageDelivery(owners, new Set(["thread-1"]), "thread-1", true, "queue")
    ).toEqual({
        type: "desktop",
        ownerClientId: "client-desktop"
      });
  });

  it("uses app-server delivery for a task created by Codex Mobile without an owner", () => {
    expect(
      resolveMessageDelivery(
        new Map(),
        new Set(["thread-new"]),
        "thread-new",
        true,
        "queue"
      )
    ).toEqual({ type: "app-server" });
  });

  it("discovers Desktop ownership before queueing on an active ownerless task", () => {
    const appServerOwnedThreadIds = new Set<string>();

    expect(
      resolveMessageDelivery(
        new Map(),
        appServerOwnedThreadIds,
        "thread-existing",
        true,
        "queue"
      )
    ).toEqual({ type: "desktop-discovery" });
    expect(appServerOwnedThreadIds.has("thread-existing")).toBe(false);
  });

  it("discovers Desktop ownership before steering an active ownerless task", () => {
    expect(
      resolveMessageDelivery(new Map(), new Set(), "thread-existing", true, "steer")
    ).toEqual({ type: "desktop-discovery" });
  });

  it("uses app-server delivery for an inactive ownerless task without claiming it", () => {
    const appServerOwnedThreadIds = new Set<string>();

    expect(
      resolveMessageDelivery(
        new Map(),
        appServerOwnedThreadIds,
        "thread-inactive",
        false,
        "queue"
      )
    ).toEqual({ type: "app-server" });
    expect(appServerOwnedThreadIds.has("thread-inactive")).toBe(false);
  });
});

describe("resolveComposerMessageDelivery", () => {
  it("takes over Desktop for every existing non-Mobile task", () => {
    expect(resolveComposerMessageDelivery(new Set(), "thread-existing")).toEqual({
      type: "desktop-takeover"
    });
  });

  it("keeps a Mobile-created task on its app-server owner", () => {
    expect(
      resolveComposerMessageDelivery(new Set(["thread-mobile"]), "thread-mobile")
    ).toEqual({ type: "app-server" });
  });

  it("keeps the initial message on app-server after an early Desktop stream event", () => {
    expect(
      resolveComposerMessageDelivery(new Set(), "thread-mobile", true)
    ).toEqual({ type: "app-server" });
  });
});

describe("composerMessageDeliveryUnavailableReason", () => {
  const readiness = {
    appReady: true,
    ipcConnected: false,
    ipcInitialized: false,
    lastError: "Desktop IPC is not connected"
  };

  it("requires Desktop IPC for takeover delivery", () => {
    expect(
      composerMessageDeliveryUnavailableReason({ type: "desktop-takeover" }, readiness)
    ).toBe("Desktop IPC is not connected");
  });

  it("keeps app-server-owned tasks available", () => {
    expect(
      composerMessageDeliveryUnavailableReason({ type: "app-server" }, readiness)
    ).toBeNull();
  });
});

describe("messageDeliveryUnavailableReason", () => {
  it("keeps app-server delivery available while Desktop IPC is disconnected", () => {
    expect(
      messageDeliveryUnavailableReason(
        { type: "app-server" },
        {
          appReady: true,
          ipcConnected: false,
          ipcInitialized: false,
          lastError: "Desktop IPC is not connected"
        }
      )
    ).toBeNull();
  });

  it("requires Desktop IPC for Desktop-owned delivery", () => {
    expect(
      messageDeliveryUnavailableReason(
        { type: "desktop", ownerClientId: "client-desktop" },
        {
          appReady: true,
          ipcConnected: false,
          ipcInitialized: false,
          lastError: "Desktop IPC is not connected"
        }
      )
    ).toBe("Desktop IPC is not connected");
  });

  it("requires Desktop IPC while discovering a Desktop owner", () => {
    expect(
      messageDeliveryUnavailableReason(
        { type: "desktop-discovery" },
        {
          appReady: true,
          ipcConnected: false,
          ipcInitialized: false,
          lastError: "Desktop IPC is not connected"
        }
      )
    ).toBe("Desktop IPC is not connected");
  });

});

describe("resolveInterruptDelivery", () => {
  it("keeps a cached Desktop owner targeted", () => {
    expect(
      resolveInterruptDelivery(
        new Map([["thread-1", "client-desktop"]]),
        "thread-1",
        true,
        true
      )
    ).toEqual({ type: "desktop", ownerClientId: "client-desktop" });
  });

  it("uses app-server delivery for its active turn", () => {
    expect(resolveInterruptDelivery(new Map(), "thread-1", true, true)).toEqual({
      type: "app-server"
    });
  });

  it("discovers the Desktop owner for an ownerless rollout-active turn", () => {
    expect(resolveInterruptDelivery(new Map(), "thread-1", false, true)).toEqual({
      type: "desktop-discovery"
    });
  });

  it("uses app-server delivery when no active signal exists", () => {
    expect(resolveInterruptDelivery(new Map(), "thread-1", false, false)).toEqual({
      type: "app-server"
    });
  });
});

describe("interruptDeliveryUnavailableReason", () => {
  const disconnectedReadiness = {
    appReady: true,
    ipcConnected: false,
    ipcInitialized: false,
    lastError: "Desktop IPC is not connected"
  };

  it("keeps app-server interruption available without Desktop IPC", () => {
    expect(
      interruptDeliveryUnavailableReason({ type: "app-server" }, disconnectedReadiness)
    ).toBeNull();
  });

  it.each([
    { type: "desktop", ownerClientId: "client-desktop" } as const,
    { type: "desktop-discovery" } as const
  ])("requires Desktop IPC for $type interruption", (delivery) => {
    expect(interruptDeliveryUnavailableReason(delivery, disconnectedReadiness)).toBe(
      "Desktop IPC is not connected"
    );
  });
});

describe("resolveSideMessageDelivery", () => {
  it("keeps native Desktop delivery when the owner is cached", () => {
    expect(
      resolveSideMessageDelivery(
        new Map([["thread-desktop", "client-desktop"]]),
        new Set(),
        "thread-desktop"
      )
    ).toEqual({ type: "desktop", ownerClientId: "client-desktop" });
  });

  it("uses app-server delivery when a pre-existing thread has no cached owner", () => {
    expect(resolveSideMessageDelivery(new Map(), new Set(), "thread-existing")).toEqual({
      type: "app-server"
    });
  });

  it("keeps mobile-created threads on app-server delivery", () => {
    expect(
      resolveSideMessageDelivery(new Map(), new Set(["thread-mobile"]), "thread-mobile")
    ).toEqual({ type: "app-server" });
  });
});
