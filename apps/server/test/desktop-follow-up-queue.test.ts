import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopFollowUpQueue,
  queuedFollowUpImageIds,
  mergeQueuedFollowUps
} from "../src/desktop-follow-up-queue.js";

const messages = [
  {
    id: "queue-1",
    text: "first",
    context: { prompt: "first", imageAttachments: [] },
    cwd: "/workspace",
    createdAt: 1_700_000_000_000
  },
  {
    id: "queue-2",
    text: "second",
    context: { prompt: "second", imageAttachments: [] },
    cwd: "/workspace",
    createdAt: 1_700_000_000_001
  }
];

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function queueFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-queue-"));
  directories.push(directory);
  return path.join(directory, "global-state.json");
}

describe("DesktopFollowUpQueue", () => {
  it("hydrates existing Desktop messages after a PWA restart and observes persisted removals", () => {
    const file = queueFile();
    fs.writeFileSync(file, JSON.stringify({ "queued-follow-ups": { "thread-1": messages } }));
    const queue = new DesktopFollowUpQueue(file);
    queue.refreshFromDisk();
    expect(queue.list("thread-1").map(message => message.id)).toEqual(["queue-1", "queue-2"]);
    queue.update("thread-1", messages.slice(1));
    queue.refreshFromDisk();
    expect(queue.list("thread-1").map(message => message.id)).toEqual(["queue-2"]);
    fs.writeFileSync(file, JSON.stringify({ "queued-follow-ups": {} }));
    queue.refreshFromDisk();
    expect(queue.list("thread-1")).toEqual([]);
  });

  it("does not turn malformed persisted messages into an empty queue", () => {
    const file = queueFile();
    fs.writeFileSync(file, JSON.stringify({ "queued-follow-ups": { "thread-1": [{ id: "invalid" }] } }));
    const queue = new DesktopFollowUpQueue(file);
    expect(() => queue.refreshFromDisk()).toThrow();
  });

  it("keeps pending messages from both transports visible, deduplicated in time order", () => {
    expect(mergeQueuedFollowUps(
      [{ id: "desktop", createdAt: 2 }, { id: "shared", createdAt: 3 }],
      [{ id: "app-server", createdAt: 1 }, { id: "shared", createdAt: 3 }]
    ).map(message => message.id)).toEqual(["app-server", "desktop", "shared"]);
  });

  it("serializes mutations per thread while allowing other threads to proceed", async () => {
    const queue = new DesktopFollowUpQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.runExclusive("thread-1", async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
      return "first-result";
    });
    const second = queue.runExclusive("thread-1", async () => {
      order.push("second");
      return "second-result";
    });
    const other = queue.runExclusive("thread-2", async () => {
      order.push("other");
      return "other-result";
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(["first-start", "other"]);

    if (!releaseFirst) throw new Error("First queue operation did not start");
    releaseFirst();

    await expect(Promise.all([first, second, other])).resolves.toEqual([
      "first-result",
      "second-result",
      "other-result"
    ]);
    expect(order).toEqual(["first-start", "other", "first-end", "second"]);
  });

  it("retains native context while exposing public queue fields", () => {
    const queue = new DesktopFollowUpQueue();
    expect(queue.hasThread("thread-1")).toBe(false);
    queue.update("thread-1", messages);

    expect(queue.hasThread("thread-1")).toBe(true);
    expect(queue.list("thread-1")).toEqual([
      { id: "queue-1", text: "first", createdAt: 1_700_000_000_000 },
      { id: "queue-2", text: "second", createdAt: 1_700_000_000_001 }
    ]);
    expect(queue.getNative("thread-1", "queue-1")?.context).toEqual(messages[0]?.context);

    queue.update("thread-1", []);
    expect(queue.hasThread("thread-1")).toBe(false);
  });

  it("edits and removes one message without changing order or context", () => {
    const queue = new DesktopFollowUpQueue();
    queue.update("thread-1", messages);

    const edited = queue.edit("thread-1", "queue-1", "revised");
    expect(edited?.map((message) => message.text)).toEqual(["revised", "second"]);
    expect(edited?.[0]?.context).toEqual({
      ...messages[0]?.context,
      prompt: "revised"
    });

    const remaining = queue.remove("thread-1", "queue-1");
    expect(remaining?.map((message) => message.id)).toEqual(["queue-2"]);
  });

  it("extracts opaque upload ids from native queued image context", () => {
    expect(queuedFollowUpImageIds({
      id: "queue-image",
      text: "",
      cwd: "/workspace",
      createdAt: 1,
      context: {
        prompt: "",
        addedFiles: [],
        fileAttachments: [],
        ideContext: null,
        workspaceRoots: ["/workspace"],
        imageAttachments: [
          {
            id: "image-1",
            src: "file:///tmp/paste.png",
            localPath: "/tmp/paste.png",
            filename: "paste.png",
            uploadStatus: "complete"
          }
        ]
      }
    })).toEqual(["image-1"]);
  });
});
