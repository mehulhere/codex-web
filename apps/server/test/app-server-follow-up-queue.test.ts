import { describe, expect, it, vi } from "vitest";
import { AppServerFollowUpQueue } from "../src/app-server-follow-up-queue.js";

describe("AppServerFollowUpQueue", () => {
  const image = {
    id: "image-1",
    sessionKey: "session-a",
    filename: "paste.png",
    mediaType: "image/png" as const,
    size: 12,
    path: "/tmp/paste.png"
  };

  it("queues and flushes an image-only follow-up without exposing a text requirement", async () => {
    const queue = new AppServerFollowUpQueue();
    const item = queue.enqueue("thread-1", "", [image]);
    const send = vi.fn().mockResolvedValue(undefined);

    expect(queue.list("thread-1")[0]?.images).toEqual([image]);
    await queue.flushReady({ isActive: async () => false, isOwned: () => true, send });
    expect(send).toHaveBeenCalledWith("thread-1", "", [image]);
    expect(queue.list("thread-1")).toEqual([]);
    expect(item.text).toBe("");
  });

  it("lists queued messages with stable ids and timestamps", () => {
    const queue = new AppServerFollowUpQueue();
    const item = queue.enqueue("thread-1", "follow up");

    expect(queue.list("thread-1")).toEqual([item]);
    expect(item.id).toEqual(expect.any(String));
    expect(item.createdAt).toEqual(expect.any(Number));
  });

  it("edits and removes queued messages by id", () => {
    const queue = new AppServerFollowUpQueue();
    const first = queue.enqueue("thread-1", "first");
    const second = queue.enqueue("thread-1", "second");

    expect(queue.edit("thread-1", first.id, "revised")).toMatchObject({
      id: first.id,
      text: "revised"
    });
    expect(queue.remove("thread-1", second.id)).toEqual(second);
    expect(queue.list("thread-1").map((item) => item.text)).toEqual(["revised"]);
  });

  it("takes a queued message for immediate steering", () => {
    const queue = new AppServerFollowUpQueue();
    const item = queue.enqueue("thread-1", "send now");

    expect(queue.take("thread-1", item.id)).toEqual(item);
    expect(queue.list("thread-1")).toEqual([]);
  });

  it("does not start a queued turn while the current turn is active", async () => {
    const queue = new AppServerFollowUpQueue();
    const send = vi.fn();
    queue.enqueue("thread-1", "follow up");
    await queue.flushReady({ isActive: async () => true, isOwned: () => true, send });
    expect(send).not.toHaveBeenCalled();
    expect(queue.size("thread-1")).toBe(1);
  });

  it("starts one queued turn after the active turn completes", async () => {
    const queue = new AppServerFollowUpQueue();
    const send = vi.fn().mockResolvedValue(undefined);
    queue.enqueue("thread-1", "first");
    queue.enqueue("thread-1", "second");
    await queue.flushReady({ isActive: async () => false, isOwned: () => true, send });
    expect(send).toHaveBeenCalledWith("thread-1", "first");
    expect(queue.size("thread-1")).toBe(1);
  });

  it("hands all queued messages to a newly published Desktop owner", async () => {
    const queue = new AppServerFollowUpQueue();
    queue.enqueue("thread-1", "first");
    queue.enqueue("thread-1", "second");
    const send = vi.fn().mockResolvedValue(undefined);
    await queue.handoffThread("thread-1", send);
    expect(send.mock.calls).toEqual([["first"], ["second"]]);
    expect(queue.size("thread-1")).toBe(0);
  });

  it("retains failed and remaining handoff messages for retry", async () => {
    const queue = new AppServerFollowUpQueue();
    queue.enqueue("thread-1", "first");
    queue.enqueue("thread-1", "second");
    await expect(queue.handoffThread("thread-1", async () => {
      throw new Error("owner unavailable");
    })).rejects.toThrow("owner unavailable");
    expect(queue.size("thread-1")).toBe(2);
  });

  it("does not use the app-server transport after ownership changes during its active check", async () => {
    const queue = new AppServerFollowUpQueue();
    const send = vi.fn();
    let owned = true;
    queue.enqueue("thread-1", "follow up");
    await queue.flushReady({
      isActive: async () => {
        owned = false;
        return false;
      },
      isOwned: () => owned,
      send
    });
    expect(send).not.toHaveBeenCalled();
    expect(queue.size("thread-1")).toBe(1);
  });

  it("does not let a new message bypass an existing queue", async () => {
    const queue = new AppServerFollowUpQueue();
    const send = vi.fn();
    queue.enqueue("thread-1", "first");
    const result = await queue.enqueueOrSend({
      threadId: "thread-1",
      text: "second",
      isActive: async () => false,
      isOwned: () => true,
      send
    });
    expect(result).toBe("queued");
    expect(send).not.toHaveBeenCalled();
    expect(queue.size("thread-1")).toBe(2);
  });

  it("returns ownership changes instead of starting on the old transport", async () => {
    const queue = new AppServerFollowUpQueue();
    const send = vi.fn();
    let owned = true;
    const result = await queue.enqueueOrSend({
      threadId: "thread-1",
      text: "message",
      isActive: async () => {
        owned = false;
        return false;
      },
      isOwned: () => owned,
      send
    });
    expect(result).toBe("owner-changed");
    expect(send).not.toHaveBeenCalled();
  });

  it("releases an owned task after completion when no follow-up is queued", async () => {
    const queue = new AppServerFollowUpQueue();
    const release = vi.fn().mockResolvedValue(undefined);

    await expect(
      queue.releaseIfIdle({
        threadId: "thread-1",
        isOwned: () => true,
        release
      })
    ).resolves.toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps an owned task while a follow-up is queued", async () => {
    const queue = new AppServerFollowUpQueue();
    const release = vi.fn().mockResolvedValue(undefined);
    queue.enqueue("thread-1", "next message");

    await expect(
      queue.releaseIfIdle({
        threadId: "thread-1",
        isOwned: () => true,
        release
      })
    ).resolves.toBe(false);
    expect(release).not.toHaveBeenCalled();
  });
});
