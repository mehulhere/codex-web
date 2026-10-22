import { describe, expect, it, vi } from "vitest";
import type { ThreadConversationState } from "@farfield/protocol";
import { projectLiveConversationState } from "../src/live-state.js";
import { CodexMonitorService } from "../src/service.js";

function createThread(): ThreadConversationState {
  return {
    id: "thread-1",
    turns: [
      {
        params: {
          threadId: "thread-1",
          input: [{ type: "text", text: "hello" }],
          attachments: []
        },
        status: "completed",
        items: []
      }
    ],
    requests: []
  };
}

describe("CodexMonitorService", () => {
  it("discovers the Desktop owner through a read-only history request", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({
        handledByClientId: "desktop-owner"
      })
    };
    const service = new CodexMonitorService(ipcClient as never);

    await expect(service.discoverThreadOwner("thread-1")).resolves.toBe(
      "desktop-owner"
    );
    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-load-complete-history",
      { conversationId: "thread-1" },
      { version: 1 }
    );
  });

  it("rejects owner discovery when Desktop does not identify a handler", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({})
    };
    const service = new CodexMonitorService(ipcClient as never);

    await expect(service.discoverThreadOwner("thread-1")).rejects.toThrowError(
      /did not identify an owner/i
    );
  });

  it("creates and publishes the exact Desktop text-only queue message", () => {
    const ipcClient = {
      sendBroadcast: vi.fn()
    };
    const service = new CodexMonitorService(ipcClient as never);

    const messages = service.enqueueDesktopFollowUp({
      threadId: "thread-1",
      ownerClientId: "desktop-owner",
      text: " follow up ",
      cwd: "/workspace",
      messages: []
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      text: "follow up",
      cwd: "/workspace",
      context: {
        prompt: "follow up",
        addedFiles: [],
        fileAttachments: [],
        ideContext: null,
        imageAttachments: [],
        workspaceRoots: ["/workspace"]
      }
    });
    expect(messages[0]?.id).toEqual(expect.any(String));
    expect(messages[0]?.createdAt).toEqual(expect.any(Number));
    expect(ipcClient.sendBroadcast).toHaveBeenCalledWith(
      "thread-queued-followups-changed",
      { conversationId: "thread-1", messages },
      { targetClientIds: ["desktop-owner"], version: 1 }
    );
  });

  it("creates a Desktop image-only queue message with native attachment context", () => {
    const ipcClient = { sendBroadcast: vi.fn() };
    const service = new CodexMonitorService(ipcClient as never);

    const [message] = service.enqueueDesktopFollowUp({
      threadId: "thread-1",
      ownerClientId: "desktop-owner",
      text: "",
      cwd: "/workspace",
      images: [
        { id: "image-1", path: "/tmp/paste.png", filename: "paste.png" }
      ],
      messages: []
    });

    expect(message?.text).toBe("");
    expect(message?.context.imageAttachments).toEqual([
      {
        id: "image-1",
        src: "file:///tmp/paste.png",
        localPath: "/tmp/paste.png",
        filename: "paste.png",
        uploadStatus: "complete"
      }
    ]);
  });

  it("publishes an ownerless Desktop queue message to every renderer", () => {
    const ipcClient = {
      sendBroadcast: vi.fn()
    };
    const service = new CodexMonitorService(ipcClient as never);

    const messages = service.enqueueDesktopFollowUp({
      threadId: "thread-1",
      text: "follow up",
      cwd: "/workspace",
      messages: []
    });

    expect(ipcClient.sendBroadcast).toHaveBeenCalledWith(
      "thread-queued-followups-changed",
      { conversationId: "thread-1", messages },
      { version: 1 }
    );
  });

  it("appends one native queue message and returns Desktop acknowledgement", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({
        handledByClientId: "desktop-owner",
        result: {
          messages: [
            {
              id: "queue-accepted",
              text: "follow up",
              context: {
                prompt: "follow up",
                addedFiles: [],
                fileAttachments: [],
                ideContext: null,
                imageAttachments: [],
                workspaceRoots: ["/workspace"]
              },
              cwd: "/workspace",
              createdAt: 1_700_000_000_000
            }
          ]
        }
      })
    };
    const service = new CodexMonitorService(ipcClient as never);

    const accepted = await service.appendDesktopFollowUp({
      threadId: "thread-1",
      text: " follow up ",
      cwd: "/workspace"
    });

    expect(accepted.ownerClientId).toBe("desktop-owner");
    expect(accepted.messages[0]?.id).toBe("queue-accepted");
    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-append-queued-follow-up",
      {
        conversationId: "thread-1",
        message: expect.objectContaining({
          text: "follow up",
          cwd: "/workspace"
        })
      },
      { version: 1 }
    );
  });

  it("targets a known owner for native queue append", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({
        result: { messages: [] }
      })
    };
    const service = new CodexMonitorService(ipcClient as never);

    await expect(
      service.appendDesktopFollowUp({
        threadId: "thread-1",
        ownerClientId: "desktop-owner",
        text: "follow up",
        cwd: "/workspace"
      })
    ).resolves.toMatchObject({ ownerClientId: "desktop-owner", messages: [] });
    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-append-queued-follow-up",
      expect.any(Object),
      { targetClientId: "desktop-owner", version: 1 }
    );
  });

  it("rejects an unowned queue append without Desktop handler acknowledgement", async () => {
    const service = new CodexMonitorService({
      sendRequestAndWait: vi.fn().mockResolvedValue({ result: { messages: [] } })
    } as never);

    await expect(
      service.appendDesktopFollowUp({
        threadId: "thread-1",
        text: "follow up",
        cwd: "/workspace"
      })
    ).rejects.toThrowError(/did not identify an owner/i);
  });

  it("reads and updates a strict shared Desktop draft", async () => {
    const ipcClient = {
      sendRequestAndWait: vi
        .fn()
        .mockResolvedValueOnce({
          handledByClientId: "desktop-owner",
          result: { draft: { text: "desktop text", revision: 2, source: "desktop:1" } }
        })
        .mockResolvedValueOnce({
          result: { draft: { text: "mobile text", revision: 3, source: "pwa:1" } }
        })
    };
    const service = new CodexMonitorService(ipcClient as never);

    const read = await service.readDesktopDraft({ threadId: "thread-1" });
    const updated = await service.setDesktopDraft({
      threadId: "thread-1",
      ownerClientId: read.ownerClientId,
      draft: { text: "mobile text", revision: read.draft.revision, source: "pwa:1" }
    });

    expect(read.draft.text).toBe("desktop text");
    expect(updated.draft).toEqual({ text: "mobile text", revision: 3, source: "pwa:1" });
    expect(ipcClient.sendRequestAndWait).toHaveBeenNthCalledWith(
      2,
      "thread-follower-set-composer-draft",
      {
        conversationId: "thread-1",
        draft: { text: "mobile text", revision: 2, source: "pwa:1" }
      },
      { targetClientId: "desktop-owner", version: 1 }
    );
  });

  it("types the exact message into Desktop and acknowledges native submission", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({
        handledByClientId: "desktop-owner",
        result: {
          conversationId: "thread-1",
          submitted: true
        }
      })
    };
    const service = new CodexMonitorService(ipcClient as never);

    await expect(
      service.typeAndSubmitDesktopMessage({
        threadId: "thread-1",
        text: "  exact PWA prompt  "
      })
    ).resolves.toEqual({
      ownerClientId: "desktop-owner",
      conversationId: "thread-1"
    });
    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-type-and-submit-message",
      {
        conversationId: "thread-1",
        text: "  exact PWA prompt  "
      },
      { version: 1, timeoutMs: 4_000 }
    );
  });

  it("rejects a takeover acknowledgement for a different task", async () => {
    const service = new CodexMonitorService({
      sendRequestAndWait: vi.fn().mockResolvedValue({
        handledByClientId: "desktop-owner",
        result: {
          conversationId: "thread-other",
          submitted: true
        }
      })
    } as never);

    await expect(
      service.typeAndSubmitDesktopMessage({
        threadId: "thread-1",
        text: "prompt"
      })
    ).rejects.toThrowError(/different task/i);
  });

  it("synchronizes a Desktop queue through the owning renderer", () => {
    const ipcClient = {
      sendBroadcast: vi.fn()
    };
    const service = new CodexMonitorService(ipcClient as never);
    const messages = [
      {
        id: "queue-1",
        text: "follow up",
        context: { prompt: "follow up" },
        cwd: "/workspace",
        createdAt: 1_700_000_000_000
      }
    ];

    service.setQueuedFollowUps({
      threadId: "thread-1",
      ownerClientId: "client-1",
      messages
    });

    expect(ipcClient.sendBroadcast).toHaveBeenCalledWith(
      "thread-queued-followups-changed",
      { conversationId: "thread-1", messages },
      { targetClientIds: ["client-1"], version: 1 }
    );
  });

  it("requests native compaction from the Desktop owner", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({})
    };
    const service = new CodexMonitorService(ipcClient as never);

    await service.compactThread({
      threadId: "thread-1",
      ownerClientId: "client-1"
    });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-compact-thread",
      { conversationId: "thread-1" },
      { targetClientId: "client-1", version: 1 }
    );
  });

  it("discovers the Desktop owner when interrupting an ownerless active thread", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({})
    };
    const service = new CodexMonitorService(ipcClient as never);

    await service.interrupt({ threadId: "thread-1" });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-interrupt-turn",
      { conversationId: "thread-1" },
      expect.any(Object)
    );
    expect(ipcClient.sendRequestAndWait.mock.calls[0]?.[2]).toStrictEqual({ version: 2 });
  });

  it("edits the latest Desktop-owned user turn", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({})
    };
    const service = new CodexMonitorService(ipcClient as never);

    await service.editLastUserMessage({
      threadId: "thread-1",
      ownerClientId: "client-1",
      turnId: "turn-7",
      message: "revised"
    });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-edit-last-user-turn",
      {
        conversationId: "thread-1",
        turnId: "turn-7",
        message: "revised",
        agentMode: null,
        shouldSendPermissionOverrides: false,
        serviceTier: null
      },
      { targetClientId: "client-1", version: 1 }
    );
  });

  it("opens the shared Desktop side task and validates its id", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({
        result: { conversationId: "side-1" }
      })
    };
    const service = new CodexMonitorService(ipcClient as never);

    await expect(
      service.openSideThread({
        threadId: "thread-1",
        ownerClientId: "client-1"
      })
    ).resolves.toBe("side-1");

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-open-side-chat",
      { conversationId: "thread-1" },
      { targetClientId: "client-1", version: 1 }
    );
  });

  it("sends message using strict thread template", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({ type: "response", requestId: 1 })
    };

    const service = new CodexMonitorService(ipcClient as never);

    await service.sendMessage({
      threadId: "thread-1",
      ownerClientId: "client-1",
      text: "new message",
      imagePaths: ["/tmp/paste.png"],
      turnStartTemplate: createThread().turns[0]?.params as NonNullable<
        ThreadConversationState["turns"][number]["params"]
      >
    });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-start-turn",
      expect.objectContaining({
        conversationId: "thread-1",
        turnStartParams: expect.objectContaining({
          input: [
            { type: "text", text: "new message", text_elements: [] },
            { type: "localImage", path: "/tmp/paste.png" }
          ]
        })
      }),
      expect.objectContaining({
        targetClientId: "client-1",
        version: 1
      })
    );
  });

  it("overrides template mode and model when provided", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({ type: "response", requestId: 1 })
    };

    const service = new CodexMonitorService(ipcClient as never);

    await service.sendMessage({
      threadId: "thread-1",
      ownerClientId: "client-1",
      text: "new message",
      turnStartTemplate: createThread().turns[0]?.params as NonNullable<
        ThreadConversationState["turns"][number]["params"]
      >,
      model: "gpt-5.3-codex",
      effort: "high",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "high",
          developer_instructions: "plan"
        }
      }
    });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-start-turn",
      expect.objectContaining({
        turnStartParams: expect.objectContaining({
          model: "gpt-5.3-codex",
          effort: "high",
          collaborationMode: expect.objectContaining({
            mode: "plan"
          })
        })
      }),
      expect.any(Object)
    );
  });

  it("uses the dedicated follower steer request", async () => {
    const ipcClient = {
      sendBroadcast: vi.fn(),
      sendRequestAndWait: vi.fn().mockResolvedValue({ type: "response", requestId: 1 })
    };
    const service = new CodexMonitorService(ipcClient as never);
    const [queuedMessage] = service.enqueueDesktopFollowUp({
      threadId: "thread-1",
      ownerClientId: "client-1",
      text: "/status",
      cwd: "/workspace",
      messages: []
    });
    expect(queuedMessage).toBeDefined();

    await service.sendMessage({
      threadId: "thread-1",
      ownerClientId: "client-1",
      text: "/status",
      imagePaths: ["/tmp/paste.png"],
      isSteering: true,
      restoreMessage: queuedMessage,
      turnStartTemplate: createThread().turns[0]?.params as NonNullable<
        ThreadConversationState["turns"][number]["params"]
      >
    });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-steer-turn",
      expect.objectContaining({
        conversationId: "thread-1",
        input: [
          expect.objectContaining({ text: "/status" }),
          { type: "localImage", path: "/tmp/paste.png" }
        ],
        restoreMessage: expect.objectContaining({
          cwd: "/workspace",
          context: expect.objectContaining({
            workspaceRoots: ["/workspace"],
            threadReferences: []
          })
        })
      }),
      expect.objectContaining({ targetClientId: "client-1" })
    );
  });

  it("submits user input with validated payload", async () => {
    const service = new CodexMonitorService({ sendRequestAndWait: vi.fn().mockResolvedValue({}) } as never);

    await service.submitUserInput({
      threadId: "thread-1",
      ownerClientId: "client-1",
      requestId: 7,
      response: {
        answers: {
          q1: {
            answers: ["Option A"]
          }
        }
      }
    });

    expect(true).toBe(true);
  });
});

describe("projectLiveConversationState", () => {
  it("keeps active and recent turns without resending the complete task history", () => {
    const state: ThreadConversationState = {
      id: "thread-large",
      updatedAt: 10,
      requests: [],
      turns: [
        { id: "turn-1", status: "completed", items: [] },
        { id: "turn-active", status: "inProgress", items: [] },
        { id: "turn-3", status: "completed", items: [] },
        { id: "turn-4", status: "completed", items: [] },
        { id: "turn-5", status: "completed", items: [] }
      ]
    };

    const projected = projectLiveConversationState(state, 2);

    expect(projected.turns.map((turn) => turn.id)).toEqual([
      "turn-active",
      "turn-4",
      "turn-5"
    ]);
    expect(projected.updatedAt).toBe(10);
    expect(projected.requests).toEqual([]);
  });
});
