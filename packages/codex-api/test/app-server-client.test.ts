import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";
import {
  ChildProcessAppServerTransport,
  type AppServerNotificationListener,
  type AppServerTransport
} from "../src/app-server-transport.js";

const ResumeThreadResponseFixture = {
  thread: {
    id: "thread-1",
    preview: "preview",
    createdAt: 1,
    updatedAt: 1
  },
  model: "gpt-5.3-codex",
  cwd: "/tmp/project",
  approvalPolicy: "on-request",
  sandbox: {
    type: "dangerFullAccess"
  },
  reasoningEffort: "high"
};

const TurnStartResponseFixture = {
  turn: {
    id: "turn-1",
    status: "inProgress",
    items: []
  }
};

describe("AppServerClient persisted submission queue", () => {
  const submission = { id: "server-queue", clientUserMessageId: "client-message",
    input: [{ type: "text", text: "Pending task", text_elements: [] }] };

  it("reads every page of Desktop's admitted queue without resuming or taking ownership", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValueOnce({ data: [submission], nextCursor: "next" })
        .mockResolvedValueOnce({ data: [], nextCursor: null }), close: vi.fn()
    };
    const result = await new AppServerClient(transport).listQueuedSubmissions("thread-1");
    expect(result).toEqual([submission]);
    expect(transport.request).toHaveBeenNthCalledWith(1, "thread/queue/list", { threadId: "thread-1", limit: 100, cursor: null });
    expect(transport.request).toHaveBeenNthCalledWith(2, "thread/queue/list", { threadId: "thread-1", limit: 100, cursor: "next" });
  });

  it("uses acknowledged server queue add, edit and delete operations", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValueOnce({ queuedSubmission: submission })
        .mockResolvedValueOnce({ queuedSubmission: submission }).mockResolvedValueOnce({ deleted: true }), close: vi.fn()
    };
    const client = new AppServerClient(transport);
    await expect(client.addQueuedSubmission("thread-1", submission.input, "client-message")).resolves.toEqual(submission);
    await client.updateQueuedSubmission("thread-1", "server-queue", submission.input);
    await expect(client.deleteQueuedSubmission("thread-1", "server-queue")).resolves.toBe(true);
    expect(transport.request).toHaveBeenCalledWith("thread/queue/add", { threadId: "thread-1", input: submission.input, clientUserMessageId: "client-message" });
    expect(transport.request).toHaveBeenCalledWith("thread/queue/update", { threadId: "thread-1", queuedSubmissionId: "server-queue", input: submission.input });
    expect(transport.request).toHaveBeenCalledWith("thread/queue/delete", { threadId: "thread-1", queuedSubmissionId: "server-queue" });
  });
});

describe("AppServerClient.listThreads", () => {
  it("keeps only the newest record for a chat within a page", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({ data: [
        { id: "shared", preview: "old", createdAt: 1, updatedAt: 2 },
        { id: "other", preview: "other", createdAt: 1, updatedAt: 3 },
        { id: "shared", preview: "current", createdAt: 1, updatedAt: 4 }
      ], nextCursor: "next" }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const result = await new AppServerClient(transport).listThreads({ limit: 80, archived: false });
    expect(result.data.map(item => [item.id, item.preview])).toEqual([
      ["shared", "current"], ["other", "other"]
    ]);
    expect(result.nextCursor).toBe("next");
  });

  it("merges repeated chat ids across pages without replacing newer metadata", async () => {
    const transport: AppServerTransport = {
      request: vi.fn()
        .mockResolvedValueOnce({ data: [
          { id: "shared", preview: "current", createdAt: 1, updatedAt: 4 }
        ], nextCursor: "next" })
        .mockResolvedValueOnce({ data: [
          { id: "shared", preview: "old", createdAt: 1, updatedAt: 2 },
          { id: "other", preview: "other", createdAt: 1, updatedAt: 1 }
        ], nextCursor: null }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const result = await new AppServerClient(transport).listThreadsAll({ limit: 80, archived: false, maxPages: 3 });
    expect(result.data.map(item => [item.id, item.preview])).toEqual([
      ["shared", "current"], ["other", "other"]
    ]);
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("starts chats with the inline history contract used by the PWA reader", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue(ResumeThreadResponseFixture),
      close: vi.fn().mockResolvedValue(undefined)
    };
    await new AppServerClient(transport).startThread({ cwd: "/tmp/project" });
    expect(transport.request).toHaveBeenCalledWith("thread/start", {
      cwd: "/tmp/project", historyMode: "legacy"
    });
  });

  it("requests every model provider so Desktop history stays unified", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.listThreads({ limit: 80, archived: false });

    expect(transport.request).toHaveBeenCalledWith("thread/list", {
      limit: 80,
      archived: false,
      cursor: null,
      modelProviders: []
    });
  });
});

describe("AppServerClient task ownership", () => {
  it("registers completion notifications on the child transport without starting it", async () => {
    const transport = new ChildProcessAppServerTransport({
      executablePath: process.execPath,
      userAgent: "farfield-test"
    });
    const client = new AppServerClient(transport);

    const unsubscribe = client.onTurnCompleted(vi.fn());

    expect(unsubscribe).toBeTypeOf("function");
    unsubscribe();
    await client.close();
  });

  it("unsubscribes from a completed task", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({ status: "unsubscribed" }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await expect(client.unsubscribeThread("thread-1")).resolves.toEqual({
      status: "unsubscribed"
    });
    expect(transport.request).toHaveBeenCalledWith("thread/unsubscribe", {
      threadId: "thread-1"
    });
  });

  it("emits a strictly parsed completion notification", () => {
    const listeners: AppServerNotificationListener[] = [];
    const transport: AppServerTransport = {
      request: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      onNotification: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    const completed = vi.fn();
    const client = new AppServerClient(transport);

    client.onTurnCompleted(completed);
    listeners[0]?.({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", items: [] }
      }
    });

    expect(completed).toHaveBeenCalledWith({
      threadId: "thread-1",
      turn: { id: "turn-1", status: "completed", items: [] }
    });
  });
});

describe("AppServerClient thread settings", () => {
  it("sends a message after resuming a thread with current Codex settings", async () => {
    const transport: AppServerTransport = {
      request: vi.fn()
        .mockResolvedValueOnce({
          ...ResumeThreadResponseFixture,
          disabledPluginIds: [],
          collaborationMode: {
            mode: "default",
            settings: { model: "gpt-6.1-sol", reasoning_effort: "high", developer_instructions: null }
          }
        })
        .mockResolvedValueOnce(TurnStartResponseFixture),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const client = new AppServerClient(transport);
    await expect(client.sendUserMessage("thread-1", "Check the result")).resolves.toBeUndefined();
    expect(transport.request).toHaveBeenNthCalledWith(1, "thread/resume", { threadId: "thread-1", excludeTurns: true });
    expect(transport.request).toHaveBeenNthCalledWith(2, "turn/start", {
      threadId: "thread-1", input: [{ type: "text", text: "Check the result", text_elements: [] }]
    });
  });

  it("resumes thread metadata without loading turns", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue(ResumeThreadResponseFixture),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    const result = await client.resumeThreadMetadata("thread-1");

    expect(transport.request).toHaveBeenCalledWith("thread/resume", {
      threadId: "thread-1",
      excludeTurns: true
    });
    expect(result).toEqual(ResumeThreadResponseFixture);
  });

  it("reads authoritative settings without acquiring a writer or loading turns", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({ thread: {
        ...ResumeThreadResponseFixture.thread,
        turns: [],
        model: "gpt-6.1-sol",
        modelProvider: "openai",
        reasoningEffort: "high"
      } }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    const settings = await client.readThreadSettings("thread-1");

    expect(transport.request).toHaveBeenCalledWith("thread/read", {
      threadId: "thread-1",
      includeTurns: false
    });
    expect(settings).toEqual({
      model: "gpt-6.1-sol",
      modelProvider: "openai",
      reasoningEffort: "high"
    });
  });

  it("reads settings from thread/start without resuming an unmaterialized task", async () => {
    const transport: AppServerTransport = {
      request: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    const settings = await client.readThreadSettings(
      "thread-1",
      ResumeThreadResponseFixture
    );

    expect(transport.request).not.toHaveBeenCalled();
    expect(settings).toEqual({
      model: "gpt-5.3-codex",
      modelProvider: null,
      reasoningEffort: "high"
    });
  });

  it("reads settings from a Desktop-owned live task without resuming it", async () => {
    const transport: AppServerTransport = {
      request: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    const settings = await client.readThreadSettings("thread-1", undefined, {
      id: "thread-1",
      turns: [],
      requests: [],
      latestModel: "gpt-5.6-sol",
      latestReasoningEffort: "high"
    });

    expect(transport.request).not.toHaveBeenCalled();
    expect(settings).toEqual({
      model: "gpt-5.6-sol",
      modelProvider: null,
      reasoningEffort: "high"
    });
  });

  it("updates sticky model and effort settings", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.updateThreadSettings({
      threadId: "thread-1",
      model: "gpt-5.5",
      effort: "xhigh"
    });

    expect(transport.request).toHaveBeenCalledWith("thread/settings/update", {
      threadId: "thread-1",
      model: "gpt-5.5",
      effort: "xhigh"
    });
  });

  it("deletes a thread through app-server", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.deleteThread("thread-1");

    expect(transport.request).toHaveBeenCalledWith("thread/delete", {
      threadId: "thread-1"
    });
  });
});

describe("AppServerClient native thread operations", () => {
  it("forks an ephemeral thread without returning turns", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue(ResumeThreadResponseFixture),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.forkThread({
      threadId: "parent",
      cwd: "/workspace/project",
      ephemeral: true,
      excludeTurns: true
    });

    expect(transport.request).toHaveBeenCalledWith("thread/fork", {
      threadId: "parent",
      cwd: "/workspace/project",
      ephemeral: true,
      excludeTurns: true
    });
  });

  it("injects only the side-conversation boundary item", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.injectThreadItems("thread-1", [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Side conversation boundary" }]
      }
    ]);

    expect(transport.request).toHaveBeenCalledWith("thread/inject_items", {
      threadId: "thread-1",
      items: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Side conversation boundary" }]
        }
      ]
    });
  });

  it("rolls back one completed turn", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({
        thread: { id: "thread-1", turns: [], requests: [] }
      }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.rollbackThread("thread-1", 1);

    expect(transport.request).toHaveBeenCalledWith("thread/rollback", {
      threadId: "thread-1",
      numTurns: 1
    });
  });

  it("starts native compaction", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.compactThread("thread-1");

    expect(transport.request).toHaveBeenCalledWith("thread/compact/start", {
      threadId: "thread-1"
    });
  });

  it("starts a replacement turn with preserved images and attachments", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue(TurnStartResponseFixture),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.startTurnWithInput(
      "thread-1",
      [
        { type: "text", text: "revised", text_elements: [] },
        { type: "localImage", path: "/workspace/image.png", detail: "high" }
      ],
      [{ name: "notes.pdf" }]
    );

    expect(transport.request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [
        { type: "text", text: "revised", text_elements: [] },
        { type: "localImage", path: "/workspace/image.png", detail: "high" }
      ],
      attachments: [{ name: "notes.pdf" }]
    });
  });
});

describe("AppServerClient.sendUserMessage", () => {
  it("steers an active app-server-owned task", async () => {
    const transport: AppServerTransport = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          thread: {
            id: "thread-1",
            turns: [{ id: "turn-1", status: "inProgress", items: [] }],
            requests: []
          }
        })
        .mockResolvedValueOnce({ turnId: "turn-1" }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const client = new AppServerClient(transport);

    await client.steerUserMessage("thread-1", "change direction", ["/tmp/paste.png"]);

    expect(transport.request).toHaveBeenNthCalledWith(1, "thread/read", {
      threadId: "thread-1",
      includeTurns: true
    });
    expect(transport.request).toHaveBeenNthCalledWith(2, "turn/steer", {
      threadId: "thread-1",
      input: [
        { type: "text", text: "change direction", text_elements: [] },
        { type: "localImage", path: "/tmp/paste.png" }
      ],
      expectedTurnId: "turn-1"
    });
  });

  it("interrupts the validated active app-server turn", async () => {
    const transport: AppServerTransport = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          thread: {
            id: "thread-1",
            turns: [{ id: "turn-7", status: "inProgress", items: [] }],
            requests: []
          }
        })
        .mockResolvedValueOnce({}),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const client = new AppServerClient(transport);
    await client.interruptTurn("thread-1");
    expect(transport.request).toHaveBeenNthCalledWith(2, "turn/interrupt", {
      threadId: "thread-1",
      turnId: "turn-7"
    });
  });

  it("starts the first turn from thread/start settings without resuming an unmaterialized task", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue(TurnStartResponseFixture),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.sendInitialUserMessage(
      ResumeThreadResponseFixture,
      "first message",
      ["/tmp/paste.png"]
    );

    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(transport.request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [
        {
          type: "text",
          text: "first message",
          text_elements: []
        },
        { type: "localImage", path: "/tmp/paste.png" }
      ]
    });
  });

  it("sends the expected request payload", async () => {
    const transport: AppServerTransport = {
      request: vi
        .fn()
        .mockResolvedValueOnce(ResumeThreadResponseFixture)
        .mockResolvedValueOnce(TurnStartResponseFixture),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.sendUserMessage("thread-1", "", ["/tmp/paste.png"]);

    expect(transport.request).toHaveBeenNthCalledWith(1, "thread/resume", {
      threadId: "thread-1",
      excludeTurns: true
    });
    expect(transport.request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [
        { type: "localImage", path: "/tmp/paste.png" }
      ]
    });
  });

  it("fails fast when turn/start response schema drifts", async () => {
    const transport: AppServerTransport = {
      request: vi
        .fn()
        .mockResolvedValueOnce(ResumeThreadResponseFixture)
        .mockResolvedValueOnce({ ok: true }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await expect(client.sendUserMessage("thread-1", "hello")).rejects.toThrow(
      /AppServerTurnStartResponse/
    );
  });

  it("fails fast when resume response schema drifts", async () => {
    const transport: AppServerTransport = {
      request: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await expect(client.sendUserMessage("thread-1", "hello")).rejects.toThrow(
      /AppServerResumeThreadResponse/
    );
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("fails fast when resume does not include sandbox", async () => {
    const transport: AppServerTransport = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          ...ResumeThreadResponseFixture,
          sandbox: undefined
        })
        .mockResolvedValueOnce({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await expect(client.sendUserMessage("thread-1", "hello")).rejects.toThrow(
      /thread\/resume did not return required field: sandbox/
    );
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
});
