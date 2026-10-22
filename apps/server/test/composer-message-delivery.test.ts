import { describe, expect, it, vi } from "vitest";
import {
  desktopComposerSubmissionNeedsResume,
  executeComposerMessageDelivery,
  resolveDesktopComposerOwner,
  resolveDesktopComposerSubmission
} from "../src/composer-message-delivery.js";

describe("resolveDesktopComposerSubmission", () => {
  it("queues text follow-ups while a Desktop-owned task is active", () => {
    expect(
      resolveDesktopComposerSubmission({
        isActive: true,
        isSteering: false,
        imageCount: 0
      })
    ).toBe("queued-follow-up");
  });

  it("uses the native composer for idle text and a direct turn for idle images", () => {
    expect(
      resolveDesktopComposerSubmission({
        isActive: false,
        isSteering: false,
        imageCount: 0
      })
    ).toBe("native-composer");
    expect(
      resolveDesktopComposerSubmission({
        isActive: false,
        isSteering: false,
        imageCount: 1
      })
    ).toBe("direct-turn");
  });

  it("steers active Desktop-owned tasks instead of queueing", () => {
    expect(
      resolveDesktopComposerSubmission({
        isActive: true,
        isSteering: true,
        imageCount: 0
      })
    ).toBe("direct-turn");
  });
});

describe("desktopComposerSubmissionNeedsResume", () => {
  it("does not resume an active Desktop task before queueing a follow-up", () => {
    expect(desktopComposerSubmissionNeedsResume("queued-follow-up")).toBe(false);
  });

  it("resumes only direct turns that need a turn template", () => {
    expect(desktopComposerSubmissionNeedsResume("native-composer")).toBe(false);
    expect(desktopComposerSubmissionNeedsResume("direct-turn")).toBe(true);
  });
});

describe("resolveDesktopComposerOwner", () => {
  it("uses the acknowledged ownerless append for active queued follow-ups", async () => {
    const discoverOwner = vi.fn().mockResolvedValue("desktop-owner");

    await expect(
      resolveDesktopComposerOwner({
        submission: "queued-follow-up",
        cachedOwnerClientId: undefined,
        discoverOwner
      })
    ).resolves.toBeNull();
    expect(discoverOwner).not.toHaveBeenCalled();
  });

  it("reuses a known queue owner and discovers one only for direct turns", async () => {
    const discoverOwner = vi.fn().mockResolvedValue("discovered-owner");

    await expect(
      resolveDesktopComposerOwner({
        submission: "queued-follow-up",
        cachedOwnerClientId: "known-owner",
        discoverOwner
      })
    ).resolves.toBe("known-owner");
    await expect(
      resolveDesktopComposerOwner({
        submission: "direct-turn",
        cachedOwnerClientId: undefined,
        discoverOwner
      })
    ).resolves.toBe("discovered-owner");
    expect(discoverOwner).toHaveBeenCalledTimes(1);
  });
});

describe("executeComposerMessageDelivery", () => {
  it("falls back to app-server when Desktop has no mounted client", async () => {
    const sendAppServer = vi.fn().mockResolvedValue(undefined);

    await expect(
      executeComposerMessageDelivery({
        delivery: { type: "desktop-takeover" },
        submitDesktop: vi
          .fn()
          .mockRejectedValue(new Error("IPC request failed: no-client-found")),
        sendAppServer
      })
    ).resolves.toEqual({
      transport: "app-server",
      ownerClientId: null,
      fallbackFromDesktop: true
    });
    expect(sendAppServer).toHaveBeenCalledWith(true);
  });

  it("routes an unavailable ownerless Desktop request through app-server", async () => {
    const error = new Error(
      "IPC request timed out: thread-follower-type-and-submit-message"
    );
    const sendAppServer = vi.fn().mockResolvedValue(undefined);

    await expect(
      executeComposerMessageDelivery({
        delivery: { type: "desktop-takeover" },
        submitDesktop: vi.fn().mockRejectedValue(error),
        sendAppServer
      })
    ).resolves.toEqual({
      transport: "app-server",
      ownerClientId: null,
      fallbackFromDesktop: true
    });
    expect(sendAppServer).toHaveBeenCalledWith(true);
  });

  it("does not route unrelated Desktop failures through app-server", async () => {
    const error = new Error("IPC request timed out");
    const sendAppServer = vi.fn().mockResolvedValue(undefined);

    await expect(
      executeComposerMessageDelivery({
        delivery: { type: "desktop-takeover" },
        submitDesktop: vi.fn().mockRejectedValue(error),
        sendAppServer
      })
    ).rejects.toBe(error);
    expect(sendAppServer).not.toHaveBeenCalled();
  });

  it("keeps app-server-owned messages on app-server", async () => {
    const submitDesktop = vi.fn();
    const sendAppServer = vi.fn().mockResolvedValue(undefined);

    await expect(
      executeComposerMessageDelivery({
        delivery: { type: "app-server" },
        submitDesktop,
        sendAppServer
      })
    ).resolves.toEqual({
      transport: "app-server",
      ownerClientId: null,
      fallbackFromDesktop: false
    });
    expect(sendAppServer).toHaveBeenCalledWith(false);
    expect(submitDesktop).not.toHaveBeenCalled();
  });

  it("reports a Desktop transfer discovered during app-server queueing", async () => {
    await expect(
      executeComposerMessageDelivery({
        delivery: { type: "app-server" },
        submitDesktop: vi.fn(),
        sendAppServer: vi.fn().mockResolvedValue({
          ownerClientId: "new-desktop-owner"
        })
      })
    ).resolves.toEqual({
      transport: "desktop-takeover",
      ownerClientId: "new-desktop-owner",
      fallbackFromDesktop: false
    });
  });

  it("returns Desktop ownership after acknowledged native submission", async () => {
    const sendAppServer = vi.fn();

    await expect(
      executeComposerMessageDelivery({
        delivery: { type: "desktop-takeover" },
        submitDesktop: vi.fn().mockResolvedValue({ ownerClientId: "desktop-owner" }),
        sendAppServer
      })
    ).resolves.toEqual({
      transport: "desktop-takeover",
      ownerClientId: "desktop-owner",
      fallbackFromDesktop: false
    });
    expect(sendAppServer).not.toHaveBeenCalled();
  });
});
