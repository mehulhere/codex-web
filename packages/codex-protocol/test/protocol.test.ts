import { describe, expect, it } from "vitest";
import {
  parseAppServerReadThreadResponse,
  parseAppServerListThreadsResponse,
  parseAppServerListModelsResponse,
  parseAppServerCollaborationModeListResponse,
  parseAppServerResumeThreadResponse,
  parseAppServerStartThreadResponse,
  parseIpcFrame,
  parseThreadConversationState,
  parseThreadComposerDraftChangedBroadcast,
  parseThreadQueuedFollowUpsChangedBroadcast,
  parseThreadStreamStateChangedBroadcast,
  parseUserInputResponsePayload,
  DesktopAppendQueuedFollowUpResponseSchema,
  DesktopComposerDraftResponseSchema,
  DesktopTypeAndSubmitMessageResponseSchema,
  AppServerThreadUnsubscribeRequestSchema,
  AppServerThreadUnsubscribeResponseSchema,
  AppServerTurnCompletedNotificationSchema,
  AppServerTurnSteerRequestSchema,
  SharedComposerDraftSchema,
  TextQueuedFollowUpContextSchema
} from "../src/index.js";

describe("codex-protocol schemas", () => {
  it("parses asynchronous assistant questions from current thread history", () => {
    const state = parseThreadConversationState({
      id: "thread-async",
      turns: [{ id: "turn-1", status: "completed", items: [{
        id: "question-1",
        type: "agentMessage",
        text: "Choose a mode",
        delivery: "async",
        questions: [{ title: "Mode?", options: ["Fast", "Thorough"] }]
      }] }]
    });
    expect(state.turns[0]?.items[0]).toMatchObject({
      delivery: "async",
      questions: [{ title: "Mode?", options: ["Fast", "Thorough"] }]
    });
  });

  it("parses captured tool UI metadata and nullable web search action fields", () => {
    const state = parseThreadConversationState({
      id: "thread-tool-ui",
      turns: [{ id: "turn-1", status: "completed", items: [{
        id: "tool-1",
        type: "mcpToolCall",
        server: "test-server",
        tool: "show_result",
        status: "completed",
        arguments: {},
        mcpAppUi: { resourceUri: "ui://test/result", preferredModelDisplayMode: "inline" }
      }, {
        id: "search-1", type: "webSearch", query: "test", results: null,
        action: { type: "search", query: "test", queries: null }
      }, {
        id: "find-1", type: "webSearch", query: "test", results: null,
        action: { type: "findInPage", url: null, pattern: null }
      }] }]
    });
    expect(state.turns[0]?.items).toHaveLength(3);
  });

  it("parses current completed sub-agent activity metadata", () => {
    const state = parseThreadConversationState({
      id: "thread-agents",
      turns: [{ id: "turn-1", status: "completed", items: [{
        id: "agent-done", type: "subAgentActivity", kind: "completed",
        agentThreadId: "agent-thread", agentPath: "/root/worker",
        model: "gpt-6.1-sol", reasoningEffort: "high"
      }] }]
    });
    expect(state.turns[0]?.items[0]).toMatchObject({ kind: "completed", model: "gpt-6.1-sol" });
  });

  it("parses task completion and unsubscribe messages strictly", () => {
    expect(
      AppServerTurnCompletedNotificationSchema.parse({
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "completed",
          items: []
        }
      })
    ).toEqual({
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        items: []
      }
    });

    expect(
      AppServerThreadUnsubscribeRequestSchema.parse({ threadId: "thread-1" })
    ).toEqual({ threadId: "thread-1" });
    expect(
      AppServerThreadUnsubscribeResponseSchema.parse({ status: "unsubscribed" })
    ).toEqual({ status: "unsubscribed" });
    expect(() =>
      AppServerThreadUnsubscribeResponseSchema.parse({
        status: "unsubscribed",
        extra: true
      })
    ).toThrow();
  });

  it("accepts native local images in turn steering input", () => {
    expect(
      AppServerTurnSteerRequestSchema.parse({
        threadId: "thread-1",
        expectedTurnId: "turn-1",
        input: [
          { type: "text", text: "look here", text_elements: [] },
          { type: "localImage", path: "/tmp/paste.png" }
        ]
      }).input[1]
    ).toEqual({ type: "localImage", path: "/tmp/paste.png" });
  });

  it("parses Codex 0.144 thread/list metadata", () => {
    const parsed = parseAppServerListThreadsResponse({
      data: [
        {
          id: "thread-123",
          extra: null,
          sessionId: "session-123",
          forkedFromId: null,
          parentThreadId: null,
          preview: "Build the mobile client",
          ephemeral: false,
          historyMode: "legacy",
          modelProvider: "codex-multi-auth-runtime-proxy",
          createdAt: 1700000000,
          updatedAt: 1700000100,
          recencyAt: 1700000050,
          status: { type: "active", activeFlags: ["waitingOnUserInput"] },
          path: "/workspace/thread.jsonl",
          cwd: "/workspace",
          cliVersion: "0.144.1",
          source: "vscode",
          threadSource: null,
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: "Mobile client",
          isPinned: false,
          canAcceptDirectInput: null,
          section: {
            id: "00000000-0000-4000-8000-000000000006",
            name: "Projects"
          },
          sectionEnteredAt: 1_700_000_025,
          turns: []
        }
      ],
      nextCursor: "cursor-next",
      backwardsCursor: "cursor-previous"
    });

    expect(parsed.data[0]?.status.type).toBe("active");
    expect(parsed.data[0]?.isPinned).toBe(false);
    expect(parsed.data[0]?.canAcceptDirectInput).toBeNull();
    expect(parsed.data[0]?.section).toEqual({
      id: "00000000-0000-4000-8000-000000000006",
      name: "Projects"
    });
    expect(parsed.data[0]?.sectionEnteredAt).toBe(1_700_000_025);
    expect(parsed.backwardsCursor).toBe("cursor-previous");
  });

  it("parses current thread environment and model metadata strictly", () => {
    const thread = {
      id: "thread-current",
      preview: "Current task",
      createdAt: 1,
      updatedAt: 2,
      environments: [{
        environmentId: "local",
        cwd: "/workspace",
        runtimeWorkspaceRoots: ["/workspace"]
      }],
      projectId: null,
      model: "gpt-6.1-sol",
      reasoningEffort: "high",
      originator: "codex_desktop_rs",
      daybreakEnabled: null,
      section: { id: "section-current", name: "Work", appearance: { color: "blue", icon: null } }
    };
    const parsed = parseAppServerListThreadsResponse({ data: [thread], nextCursor: null });

    expect(parsed.data[0]?.environments).toEqual(thread.environments);
    expect(parsed.data[0]?.model).toBe("gpt-6.1-sol");
    expect(parsed.data[0]?.section?.appearance).toEqual({ color: "blue", icon: null });
    expect(() => parseAppServerListThreadsResponse({
      data: [{ ...thread, environments: [{ ...thread.environments[0], unexpected: true }] }]
    })).toThrow();
    expect(() => parseAppServerListThreadsResponse({
      data: [{ ...thread, daybreakEnabled: "yes" }]
    })).toThrow();
  });

  it("parses Codex 0.144 collaboration mode masks without embedded instructions", () => {
    const parsed = parseAppServerCollaborationModeListResponse({
      data: [
        {
          name: "Plan",
          mode: "plan",
          model: null,
          reasoning_effort: "medium"
        }
      ]
    });

    expect(parsed.data[0]?.name).toBe("Plan");
  });

  it("parses current model catalog metadata", () => {
    const parsed = parseAppServerListModelsResponse({
      data: [
        {
          id: "gpt-test-codex",
          model: "gpt-test-codex",
          upgrade: null,
          upgradeInfo: {
            model: "gpt-next-codex",
            migrationMarkdown: null,
            modelLink: null,
            upgradeCopy: "Try the newer model",
            retirementAt: 1_800_000_000
          },
          availabilityNux: { message: "Available now" },
          displayName: "GPT Test Codex",
          description: "Test model",
          modelSpecialty: "coding",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Balanced" }
          ],
          defaultReasoningEffort: "medium",
          inputModalities: ["text", "image"],
          supportsPersonality: true,
          isDefault: true,
          hidden: false,
          additionalSpeedTiers: ["fast"],
          serviceTiers: [
            { id: "fast", name: "Fast", description: "Lower latency" }
          ],
          defaultServiceTier: "fast",
          multiAgentVersion: "v2",
          availableAccessPrograms: { cyber: ["standard"] }
        }
      ],
      nextCursor: null
    });

    expect(parsed.data[0]?.defaultServiceTier).toBe("fast");
    expect(parsed.data[0]?.modelSpecialty).toBe("coding");
    expect(parsed.data[0]?.multiAgentVersion).toBe("v2");
    expect(parsed.data[0]?.upgradeInfo?.retirementAt).toBe(1_800_000_000);
  });

  it("parses Codex 0.144 task message metadata and rich user inputs", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "user-1",
              type: "userMessage",
              clientId: "mobile-client-1",
              content: [
                { type: "text", text: "Review these inputs" },
                { type: "localImage", path: "/workspace/image.png", detail: "high" },
                { type: "skill", name: "review", path: "/workspace/review" },
                { type: "mention", name: "spec", path: "/workspace/spec.md" }
              ]
            },
            {
              id: "agent-1",
              type: "agentMessage",
              text: "Done",
              phase: "final_answer",
              memoryCitation: {
                entries: [
                  {
                    path: "MEMORY.md",
                    lineStart: 10,
                    lineEnd: 12,
                    note: "Task context"
                  }
                ],
                threadIds: ["thread-memory-1"]
              }
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[1]?.type).toBe("agentMessage");
  });

  it("parses Codex 0.144 MCP calls and sub-agent activity", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "mcp-1",
              type: "mcpToolCall",
              server: "example-server",
              tool: "read_item",
              status: "completed",
              arguments: { itemId: "item-1" },
              appContext: null,
              durationMs: 100,
              error: null,
              mcpAppResourceUri: null,
              pluginId: null,
              readOnlyHint: true,
              result: { content: [{ type: "text", text: "ok" }] }
            },
            {
              id: "agent-activity-1",
              type: "subAgentActivity",
              agentPath: "researcher",
              agentThreadId: "thread-agent-1",
              kind: "started"
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("mcpToolCall");
  });

  it("parses every Codex 0.144 rich thread item used by desktop history", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "hook-1",
              type: "hookPrompt",
              fragments: [{ hookRunId: "run-1", text: "Check the result" }]
            },
            {
              id: "dynamic-1",
              type: "dynamicToolCall",
              tool: "image_gen",
              status: "completed",
              arguments: { prompt: "coach" },
              contentItems: [{ type: "inputText", text: "created" }],
              durationMs: 120,
              namespace: "image",
              success: true
            },
            {
              id: "collab-1",
              type: "collabAgentToolCall",
              tool: "spawnAgent",
              status: "completed",
              senderThreadId: "thread-123",
              receiverThreadIds: ["thread-agent-1"],
              agentsStates: {
                "thread-agent-1": { status: "completed", message: "Reviewed" }
              },
              model: "gpt-test",
              prompt: "Review the change",
              reasoningEffort: "medium"
            },
            { id: "view-1", type: "imageView", path: "/tmp/image.png" },
            { id: "sleep-1", type: "sleep", durationMs: 1_000 },
            {
              id: "generation-1",
              type: "imageGeneration",
              result: "created",
              status: "completed",
              revisedPrompt: null,
              savedPath: "/tmp/generated.png",
              transparentBackground: false,
              src: "data:image/png;base64,generated"
            },
            { id: "review-in-1", type: "enteredReviewMode", review: "Review started" },
            { id: "review-out-1", type: "exitedReviewMode", review: "Review complete" }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items.map((item) => item.type)).toEqual([
      "hookPrompt",
      "dynamicToolCall",
      "collabAgentToolCall",
      "imageView",
      "sleep",
      "imageGeneration",
      "enteredReviewMode",
      "exitedReviewMode"
    ]);
    expect(parsed.turns[0]?.items[5]).toMatchObject({
      type: "imageGeneration",
      src: "data:image/png;base64,generated"
    });
  });

  it("decodes large Desktop histories without scanning every item schema", () => {
    const items = Array.from({ length: 3_000 }, (_, index) => ({
      id: "agent-" + String(index),
      type: "agentMessage",
      text: "status update",
      phase: "commentary"
    }));
    const startedAt = performance.now();

    const parsed = parseThreadConversationState({
      id: "thread-large-history",
      turns: [{ status: "completed", items }],
      requests: []
    });

    expect(parsed.turns[0]?.items).toHaveLength(3_000);
    expect(performance.now() - startedAt).toBeLessThan(300);
  });

  it("parses a valid thread stream patches broadcast", () => {
    const parsed = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-123",
      version: 11,
      params: {
        conversationId: "thread-123",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 3,
          revision: 4,
          patches: [
            {
              op: "add",
              path: ["requests", 0],
              value: {
                method: "item/tool/requestUserInput",
                id: 9,
                params: {
                  threadId: "thread-123",
                  turnId: "turn-123",
                  itemId: "item-123",
                  questions: [
                    {
                      id: "question_a",
                      header: "Scope",
                      question: "Choose one",
                      isOther: true,
                      isSecret: false,
                      options: [
                        {
                          label: "Option A",
                          description: "Description A"
                        }
                      ]
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    });

    expect(parsed.params.change.type).toBe("patches");
  });

  it("parses the current Desktop thread stream snapshot envelope", () => {
    const parsed = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-123",
      version: 11,
      params: {
        conversationId: "thread-123",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 22,
          conversationState: {
            id: "thread-123",
            turns: [],
            requests: []
          }
        }
      }
    });

    expect(parsed.params.hostId).toBe("local");
    expect(parsed.params.change).toMatchObject({
      type: "snapshot",
      revision: 22
    });
  });

  it("materializes current Desktop canonical turn history into ordered turns", () => {
    const parsed = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-123",
      version: 11,
      params: {
        conversationId: "thread-123",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 22,
          conversationState: {
            id: "thread-123",
            turns: [],
            requests: [],
            turnHistory: {
              kind: "canonical",
              history: {
                entitiesByKey: {
                  "turn:turn-123": {
                    params: {
                      threadId: "thread-123",
                      input: [
                        {
                          type: "text",
                          text: "Desktop prompt"
                        }
                      ],
                      clientUserMessageId: "client-message-123",
                      commentAttachments: [],
                      multiAgentMode: "explicitRequestOnly",
                      serviceTier: null,
                      approvalsReviewer: "user",
                      permissions: ":danger-full-access",
                      runtimeWorkspaceRoots: null,
                      useAppServerPermissionDefault: false
                    },
                    turnId: "turn-123",
                    status: "completed",
                    items: [
                      {
                        id: "item-123",
                        type: "agentMessage",
                        text: "Desktop response",
                        phase: "final_answer"
                      }
                    ]
                  }
                },
                generation: 1,
                isComplete: true,
                islands: [
                  {
                    id: "tail:1",
                    entries: [
                      {
                        key: "turn:turn-123",
                        value: "turn:turn-123"
                      }
                    ],
                    olderBoundary: {
                      status: "exhausted",
                      boundaryId: "tail:1:older"
                    },
                    newerBoundary: {
                      status: "exhausted",
                      boundaryId: "tail:1:newer"
                    }
                  }
                ]
              }
            }
          }
        }
      }
    });

    expect(parsed.params.change.type).toBe("snapshot");
    if (parsed.params.change.type !== "snapshot") {
      throw new Error("Expected snapshot change");
    }
    expect(parsed.params.change.conversationState.turns).toEqual([
      expect.objectContaining({
        turnId: "turn-123",
        status: "completed",
        params: expect.objectContaining({
          runtimeWorkspaceRoots: null
        }),
        items: [
          expect.objectContaining({
            type: "agentMessage",
            text: "Desktop response"
          })
        ]
      })
    ]);
  });

  it("parses the current Desktop thread stream patches envelope", () => {
    const parsed = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-123",
      version: 11,
      params: {
        conversationId: "thread-123",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 20,
          revision: 21,
          patches: [
            {
              op: "replace",
              path: ["turns", 0, "status"],
              value: "completed"
            }
          ]
        }
      }
    });

    expect(parsed.params.change).toMatchObject({
      type: "patches",
      baseRevision: 20,
      revision: 21
    });
  });

  it("parses snapshot broadcast with null title and empty model defaults", () => {
    const parsed = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-123",
      version: 11,
      params: {
        conversationId: "thread-123",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 4,
          conversationState: {
            id: "thread-123",
            turns: [],
            requests: [],
            createdAt: 1700000000,
            updatedAt: 1700000000,
            title: null,
            latestModel: "",
            latestReasoningEffort: null,
            previousTurnModel: null,
            latestCollaborationMode: {
              mode: "default",
              settings: {
                model: "",
                reasoning_effort: null,
                developer_instructions: null
              }
            },
            hasUnreadTurn: false,
            rolloutPath: "/tmp/rollout.jsonl",
            gitInfo: null,
            resumeState: "resumed",
            latestTokenUsageInfo: null,
            cwd: "/tmp/workspace",
            source: "vscode"
          }
        }
      }
    });

    expect(parsed.params.change.type).toBe("snapshot");
  });

  it("rejects invalid patch value for remove operation", () => {
    expect(() =>
      parseThreadStreamStateChangedBroadcast({
        type: "broadcast",
        method: "thread-stream-state-changed",
        sourceClientId: "client-123",
        version: 11,
        params: {
          conversationId: "thread-123",
          hostId: "local",
          change: {
            type: "patches",
            baseRevision: 3,
            revision: 4,
            patches: [
              {
                op: "remove",
                path: ["requests", 0],
                value: true
              }
            ]
          }
        }
      })
    ).toThrowError(/remove patches must not include value/);
  });

  it("parses thread conversation state with userInputResponse item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          params: {
            threadId: "thread-123",
            input: [{ type: "text", text: "hello" }],
            attachments: []
          },
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userInputResponse",
              requestId: 12,
              turnId: "turn-1",
              questions: [{ id: "q", header: "H", question: "Q" }],
              answers: { q: ["A"] },
              completed: true
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("userInputResponse");
  });

  it("parses userInputResponse item when completed is omitted", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userInputResponse",
              requestId: 12,
              turnId: "turn-1",
              questions: [{ id: "q", header: "H", question: "Q" }],
              answers: { q: ["A"] }
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("userInputResponse");
  });

  it("parses thread conversation state with mixed text and image user content", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userMessage",
              content: [
                {
                  type: "text",
                  text: "describe this image"
                },
                {
                  type: "image",
                  url: "data:image/png;base64,AAAA"
                }
              ]
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("userMessage");
  });

  it("parses user input request questions without explicit secret flags", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [],
      requests: [
        {
          method: "item/tool/requestUserInput",
          id: 7,
          params: {
            threadId: "thread-123",
            turnId: "turn-123",
            itemId: "item-123",
            questions: [
              {
                id: "scope",
                header: "Scope",
                question: "Choose one",
                options: [
                  {
                    label: "Option A",
                    description: "Description A"
                  }
                ]
              }
            ]
          }
        }
      ]
    });

    expect(parsed.requests[0]?.params.questions[0]?.isOther).toBe(false);
    expect(parsed.requests[0]?.params.questions[0]?.isSecret).toBe(false);
  });

  it("parses steering user message item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-steering",
              type: "steeringUserMessage",
              content: [
                {
                  type: "text",
                  text: "please keep this concise"
                }
              ],
              attachments: []
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("steeringUserMessage");
  });

  it("parses an accepted normalized steering user message after a live status patch", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "inProgress",
          items: [
            {
              id: "item-steering-accepted",
              type: "steeringUserMessage",
              content: [{ type: "text", text: "continue" }],
              attachments: [],
              status: "accepted"
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]).toMatchObject({
      id: "item-steering-accepted",
      type: "steeringUserMessage",
      status: "accepted"
    });
  });

  it("parses the current Desktop steering user message item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "inProgress",
          items: [
            {
              id: "item-steering-current",
              type: "steeringUserMessage",
              targetTurnId: "turn-123",
              targetTurnStartedAtMs: 123,
              status: "accepted",
              clientUserMessageId: "client-message-123",
              input: [
                {
                  type: "text",
                  text: "continue",
                  text_elements: []
                },
                {
                  type: "localImage",
                  path: "/tmp/example.png"
                }
              ],
              attachments: [
                {
                  label: "example.png",
                  path: "/tmp/example.png",
                  fsPath: "/tmp/example.png"
                }
              ],
              restoreMessage: {
                id: "restore-message-123",
                text: "continue",
                context: {
                  addedFiles: [],
                  chatGptConversationContexts: [],
                  prompt: "continue",
                  ideContext: null,
                  imageAttachments: [
                    {
                      id: "image-123",
                      src: "blob:example",
                      localPath: "/tmp/example.png",
                      filename: "example.png",
                      uploadStatus: "complete"
                    }
                  ],
                  imageCommentDrafts: [],
                  appshotContexts: [],
                  fileAttachments: [],
                  pastedTextAttachments: [],
                  inAppBrowserContext: null,
                  commentAttachments: [],
                  mcpAppModelContextAttachments: [],
                  selectedTextAttachments: [],
                  responseTextAnnotations: [],
                  pullRequestChecks: [],
                  pullRequestMergeConflict: null,
                  workspaceRoots: ["/workspace"],
                  threadReferences: []
                },
                cwd: "/workspace",
                createdAt: 123
              },
              compareKey: {
                rawText: "continue",
                imageCount: 1
              }
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]).toMatchObject({
      id: "item-steering-current",
      type: "steeringUserMessage",
      content: [
        {
          type: "text",
          text: "continue"
        },
        {
          type: "localImage",
          path: "/tmp/example.png"
        }
      ]
    });
  });

  it("parses Desktop todo lists without an explanation", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "inProgress",
          items: [
            {
              id: "todo-123",
              type: "todo-list",
              explanation: null,
              plan: [
                {
                  step: "Verify the change",
                  status: "in_progress"
                }
              ]
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]).toMatchObject({
      type: "todo-list",
      explanation: null
    });
  });

  it("parses Desktop steering acceptance markers", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "inProgress",
          items: [
            {
              id: "steered-123",
              type: "steered"
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]).toEqual({
      id: "steered-123",
      type: "steered"
    });
  });

  it("rejects thread conversation state with unknown item types", () => {
    expect(() =>
      parseThreadConversationState({
        id: "thread-123",
        turns: [
          {
            status: "completed",
            items: [
              {
                id: "item-unknown",
                type: "toolCall",
                payload: {
                  hello: "world"
                }
              }
            ]
          }
        ],
        requests: []
      })
    ).toThrowError(/ThreadConversationState did not match expected schema/);
  });

  it("parses thread conversation state with command execution item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-cmd",
              type: "commandExecution",
              command: "echo hello",
              cwd: "/tmp",
              processId: "123",
              status: "completed",
              commandActions: [
                {
                  type: "read",
                  command: "cat file.txt",
                  name: "file.txt",
                  path: "file.txt"
                }
              ],
              aggregatedOutput: "hello",
              exitCode: 0,
              durationMs: 5,
              pluginId: "openai-bundled",
              scriptPath: "/opt/codex/tool.js"
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]).toMatchObject({
      type: "commandExecution",
      pluginId: "openai-bundled",
      scriptPath: "/opt/codex/tool.js"
    });
  });

  it("parses command action with null path and query", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-cmd",
              type: "commandExecution",
              command: "rg -n hello -S",
              status: "completed",
              commandActions: [
                {
                  type: "search",
                  command: "rg -n hello -S",
                  query: "hello",
                  path: null
                }
              ]
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("commandExecution");
  });

  it("parses thread conversation state with fileChange item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-file",
              type: "fileChange",
              status: "completed",
              changes: [
                {
                  path: "/tmp/file.txt",
                  kind: {
                    type: "update",
                    move_path: null
                  },
                  diff: "@@ -1 +1 @@\n-old\n+new\n"
                }
              ]
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("fileChange");
  });

  it("parses thread conversation state with contextCompaction and webSearch items", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-compact",
              type: "contextCompaction",
              completed: true,
              source: "automatic"
            },
            {
              id: "item-web",
              type: "webSearch",
              query: "example query",
              action: null,
              results: null
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("contextCompaction");
    expect(parsed.turns[0]).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            type: "contextCompaction",
            source: "automatic"
          }),
          expect.anything()
        ]
      })
    );
    expect(parsed.turns[0]?.items[1]).toMatchObject({
      type: "webSearch",
      action: null,
      results: null
    });
  });

  it("parses Desktop turn params when permissions are null", () => {
    const parsed = parseThreadConversationState({
      id: "thread-null-permissions",
      turns: [
        {
          status: "inProgress",
          params: {
            threadId: "thread-null-permissions",
            input: [{ type: "text", text: "hello" }],
            permissions: null
          },
          items: []
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.params?.permissions).toBeNull();
  });

  it("parses contextCompaction item when completed is omitted", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-compact",
              type: "contextCompaction"
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("contextCompaction");
  });

  it("parses thread conversation state with modelChanged item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-model",
              type: "modelChanged",
              fromModel: "gpt-5.3-codex-spark",
              toModel: "gpt-5.3-codex"
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("modelChanged");
  });

  it("parses generic ipc request frames", () => {
    const parsed = parseIpcFrame({
      type: "request",
      requestId: "request-5",
      method: "thread-follower-start-turn",
      params: {
        conversationId: "thread-123"
      },
      version: 1,
      targetClientId: "client-1"
    });

    expect(parsed.type).toBe("request");
  });

  it("parses Desktop broadcast targets as a client id array", () => {
    const parsed = parseIpcFrame({
      type: "broadcast",
      method: "thread-queued-followups-changed",
      params: {
        conversationId: "thread-123",
        messages: []
      },
      sourceClientId: "mobile-client",
      targetClientIds: ["desktop-client"],
      version: 1
    });

    expect(parsed).toMatchObject({
      type: "broadcast",
      targetClientIds: ["desktop-client"]
    });
  });

  it("rejects the unsupported singular Desktop broadcast target", () => {
    expect(() =>
      parseIpcFrame({
        type: "broadcast",
        method: "thread-queued-followups-changed",
        params: {
          conversationId: "thread-123",
          messages: []
        },
        sourceClientId: "mobile-client",
        targetClientId: "desktop-client",
        version: 1
      })
    ).toThrowError(/unrecognized/i);
  });

  it("parses strict queued follow-up broadcasts", () => {
    const parsed = parseThreadQueuedFollowUpsChangedBroadcast({
      type: "broadcast",
      method: "thread-queued-followups-changed",
      sourceClientId: "desktop-client",
      targetClientIds: ["mobile-client"],
      version: 1,
      params: {
        conversationId: "thread-123",
        messages: [
          {
            id: "queue-1",
            text: "check the result",
            context: {
              prompt: "check the result",
              imageAttachments: []
            },
            cwd: "/workspace",
            createdAt: 1_700_000_000_000
          }
        ]
      }
    });

    expect(parsed.params.messages[0]?.id).toBe("queue-1");
    expect(parsed.targetClientIds).toEqual(["mobile-client"]);
  });

  it("accepts current Desktop queue metadata and host routing", () => {
    const message = {
      id: "queue-current", text: "Check the result", context: { prompt: "Check the result" },
      cwd: "/workspace", createdAt: 1_700_000_000_000,
      responsesapiClientMetadata: { source: "desktop", client_type: "codex" },
      mentionedBrowserFamilies: ["chrome"],
      multiUserMessageSender: null,
      submissionOptions: {
        useUserMessageAdmission: true, executionHostId: "local", agentMode: "auto",
        permissionProfileId: ":workspace", serviceTier: null,
        shouldSendPermissionOverrides: false, usePermissionSelection: false,
        permissionSelection: null,
        collaborationMode: {
          mode: "default",
          settings: { model: "gpt-6.1-sol", reasoning_effort: "high", developer_instructions: null }
        },
        clientUserMessageId: "queue-current"
      },
      writingBlockAdditionalContext: null,
      submissionIntent: "queue",
      submission: { hostId: "local", status: "sending", queueModeOverride: "send-now" }
    };
    const frame = {
      type: "broadcast", method: "thread-queued-followups-changed",
      sourceClientId: "desktop-client", version: 1,
      params: { conversationId: "thread-current", hostId: "local", messages: [message] }
    };
    expect(parseThreadQueuedFollowUpsChangedBroadcast(frame).params.messages[0]).toEqual(message);
    expect(DesktopAppendQueuedFollowUpResponseSchema.parse({ messages: [message] }).messages[0])
      .toEqual(message);
    const editedMessage = {
      ...message,
      submission: {
        ...message.submission,
        editPosition: {
          messageId: "queue-current", multiUserMessageSender: null, turnTrigger: "composer",
          previousMessageId: null, nextMessageId: "queue-next",
          serverSubmission: {
            id: "server-message", clientUserMessageId: "queue-current",
            input: [{ type: "text", text: "Check the result", text_elements: [] }]
          },
          preserveSerializedContext: true
        }
      }
    };
    expect(DesktopAppendQueuedFollowUpResponseSchema.parse({ messages: [editedMessage] }).messages[0])
      .toEqual(editedMessage);
    expect(() => parseThreadQueuedFollowUpsChangedBroadcast({
      ...frame, params: { ...frame.params, hostId: 1 }
    })).toThrow();
    expect(() => DesktopAppendQueuedFollowUpResponseSchema.parse({
      messages: [{ ...message, submissionOptions: { ...message.submissionOptions, extra: true } }]
    })).toThrow();
  });

  it("parses the exact Desktop text-only queued follow-up context", () => {
    const context = TextQueuedFollowUpContextSchema.parse({
      prompt: "follow up",
      addedFiles: [],
      fileAttachments: [],
      ideContext: null,
      imageAttachments: [],
      workspaceRoots: ["/workspace"]
    });

    expect(context.workspaceRoots).toEqual(["/workspace"]);
  });

  it("rejects incomplete or extended text-only queued follow-up contexts", () => {
    expect(() =>
      TextQueuedFollowUpContextSchema.parse({
        prompt: "follow up",
        addedFiles: [],
        fileAttachments: [],
        ideContext: null,
        imageAttachments: [],
        workspaceRoots: ["/workspace"],
        extra: true
      })
    ).toThrowError(/unrecognized/i);

    expect(() =>
      TextQueuedFollowUpContextSchema.parse({
        prompt: "follow up",
        workspaceRoots: ["/workspace"]
      })
    ).toThrowError();
  });

  it("rejects queued follow-up broadcasts with unrecognized message fields", () => {
    expect(() =>
      parseThreadQueuedFollowUpsChangedBroadcast({
        type: "broadcast",
        method: "thread-queued-followups-changed",
        sourceClientId: "desktop-client",
        version: 1,
        params: {
          conversationId: "thread-123",
          messages: [
            {
              id: "queue-1",
              text: "check the result",
              context: {},
              cwd: "/workspace",
              createdAt: 1_700_000_000_000,
              unexpected: true
            }
          ]
        }
      })
    ).toThrowError(/unrecognized/i);
  });

  it("parses exact acknowledged Desktop queue and draft responses", () => {
    const queue = DesktopAppendQueuedFollowUpResponseSchema.parse({
      messages: [
        {
          id: "queue-1",
          text: "follow up",
          context: { prompt: "follow up" },
          cwd: "/workspace",
          createdAt: 1_700_000_000_000
        }
      ]
    });
    const draft = DesktopComposerDraftResponseSchema.parse({
      draft: {
        text: "unsent text",
        revision: 3,
        source: "pwa:session-1"
      }
    });

    expect(queue.messages[0]?.id).toBe("queue-1");
    expect(draft.draft.revision).toBe(3);
  });

  it("parses only an exact acknowledged Desktop takeover submission", () => {
    expect(
      DesktopTypeAndSubmitMessageResponseSchema.parse({
        conversationId: "thread-123",
        submitted: true
      })
    ).toEqual({ conversationId: "thread-123", submitted: true });

    expect(() =>
      DesktopTypeAndSubmitMessageResponseSchema.parse({
        conversationId: "thread-123",
        submitted: true,
        extra: true
      })
    ).toThrowError(/unrecognized/i);
  });

  it("accepts an intentional empty shared composer draft", () => {
    expect(
      SharedComposerDraftSchema.parse({
        text: "",
        revision: 0,
        source: "desktop"
      })
    ).toEqual({ text: "", revision: 0, source: "desktop" });
  });

  it("rejects extended queue acknowledgements and shared drafts", () => {
    expect(() =>
      DesktopAppendQueuedFollowUpResponseSchema.parse({ messages: [], ok: true })
    ).toThrowError(/unrecognized/i);
    expect(() =>
      SharedComposerDraftSchema.parse({
        text: "draft",
        revision: 1,
        source: "pwa:session-1",
        extra: true
      })
    ).toThrowError(/unrecognized/i);
  });

  it("parses strict Desktop composer draft broadcasts", () => {
    const parsed = parseThreadComposerDraftChangedBroadcast({
      type: "broadcast",
      method: "thread-composer-draft-changed",
      sourceClientId: "desktop-client",
      version: 1,
      params: {
        conversationId: "thread-123",
        draft: {
          text: "shared draft",
          revision: 4,
          source: "desktop:session-1"
        }
      }
    });

    expect(parsed.params.draft.text).toBe("shared draft");
  });

  it("parses client discovery request frames", () => {
    const parsed = parseIpcFrame({
      type: "client-discovery-request",
      requestId: "discovery-1",
      request: {
        type: "request",
        requestId: "inner-1",
        sourceClientId: "desktop-client",
        version: 0,
        method: "ide-context",
        hostId: "local",
        timeoutMs: 15_000,
        params: {
          workspaceRoot: "/tmp/workspace"
        }
      }
    });

    expect(parsed.type).toBe("client-discovery-request");
  });

  it("rejects malformed user input answer payload", () => {
    expect(() =>
      parseUserInputResponsePayload({
        answers: {
          q: {
            answers: [""]
          }
        }
      })
    ).toThrowError(/String must contain at least 1 character/);
  });

  it("parses collaboration mode list response", () => {
    const parsed = parseAppServerCollaborationModeListResponse({
      data: [
        {
          name: "Plan",
          mode: "plan",
          model: null,
          reasoning_effort: "medium",
          developer_instructions: "Instructions"
        }
      ]
    });

    expect(parsed.data[0]?.mode).toBe("plan");
  });

  it("parses app-server model/list response with modern model shape", () => {
    const parsed = parseAppServerListModelsResponse({
      data: [
        {
          id: "gpt-5.3-codex",
          model: "gpt-5.3-codex",
          upgrade: null,
          displayName: "GPT-5.3 Codex",
          description: "Latest frontier agentic coding model.",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "medium",
              description: "Balanced"
            },
            {
              reasoningEffort: "xhigh",
              description: "Deep reasoning"
            }
          ],
          defaultReasoningEffort: "xhigh",
          inputModalities: ["text", "image"],
          supportsPersonality: true,
          isDefault: true,
          hidden: false
        }
      ],
      nextCursor: null
    });

    expect(parsed.data[0]?.id).toBe("gpt-5.3-codex");
  });

  it("parses app-server thread/read response with subset validation", () => {
    const parsed = parseAppServerReadThreadResponse({
      thread: {
        id: "thread-123",
        preview: "hello",
        modelProvider: "openai",
        path: "/tmp/thread.jsonl",
        cliVersion: "0.1.0",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              {
                id: "item-1",
                type: "agentMessage",
                text: "hello"
              }
            ]
          }
        ]
      }
    });

    expect(parsed.thread.id).toBe("thread-123");
    expect(parsed.thread.requests).toEqual([]);
    expect(parsed.thread.turns[0]?.status).toBe("completed");
  });

  it("parses current app-server web search actions in thread/read responses", () => {
    const parsed = parseAppServerReadThreadResponse({
      thread: {
        id: "thread-web-search",
        preview: "research",
        modelProvider: "openai",
        path: "/tmp/thread.jsonl",
        cliVersion: "0.1.0",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              {
                type: "webSearch",
                id: "search-1",
                query: "site:example.com current docs",
                action: {
                  type: "search",
                  query: null,
                  queries: ["site:example.com current docs"]
                }
              },
              {
                type: "webSearch",
                id: "find-1",
                query: "configuration",
                action: {
                  type: "findInPage",
                  url: null,
                  pattern: "configuration"
                }
              },
              {
                type: "webSearch",
                id: "open-1",
                query: "https://example.com/docs",
                action: {
                  type: "openPage",
                  url: "https://example.com/docs"
                }
              }
            ]
          }
        ]
      }
    });

    expect(parsed.thread.turns[0]?.items).toHaveLength(3);
  });

  it("parses app-server thread/start response", () => {
    const parsed = parseAppServerStartThreadResponse({
      thread: {
        id: "thread-456",
        preview: "",
        modelProvider: "openai",
        createdAt: 1700000000,
        updatedAt: 1700000000,
        cwd: "/tmp/workspace",
        path: "/tmp/rollout.jsonl",
        cliVersion: "0.1.0",
        source: "vscode",
        gitInfo: null,
        turns: []
      },
      model: "gpt-5.3-codex",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/tmp/workspace",
      runtimeWorkspaceRoots: ["/tmp/workspace"],
      instructionSources: ["/tmp/workspace/AGENTS.md"],
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: {
        type: "dangerFullAccess"
      },
      activePermissionProfile: {
        id: ":workspace",
        extends: null
      },
      reasoningEffort: "medium",
      multiAgentMode: "explicitRequestOnly"
    });

    expect(parsed.thread.id).toBe("thread-456");
    expect(parsed.model).toBe("gpt-5.3-codex");
    expect(parsed.runtimeWorkspaceRoots).toEqual(["/tmp/workspace"]);
    expect(parsed.activePermissionProfile?.id).toBe(":workspace");
  });

  it("accepts saved plugin IDs in current start and resume responses", () => {
    const response = {
      thread: { id: "thread-plugins", preview: "", createdAt: 1, updatedAt: 1 },
      disabledPluginIds: ["example-plugin"]
    };
    expect(parseAppServerStartThreadResponse(response).disabledPluginIds).toEqual(["example-plugin"]);
    expect(parseAppServerResumeThreadResponse(response).disabledPluginIds).toEqual(["example-plugin"]);
    expect(() => parseAppServerResumeThreadResponse({
      ...response, disabledPluginIds: [42]
    })).toThrow();
  });

  it("accepts the effective collaboration mode in current resume responses", () => {
    const response = {
      thread: { id: "thread-mode", preview: "", createdAt: 1, updatedAt: 1 },
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-6.1-sol", reasoning_effort: "high", developer_instructions: null }
      }
    };
    expect(parseAppServerResumeThreadResponse(response).collaborationMode).toEqual(response.collaborationMode);
    expect(parseAppServerResumeThreadResponse({ ...response, collaborationMode: null }).collaborationMode)
      .toBeNull();
    expect(() => parseAppServerResumeThreadResponse({
      ...response, collaborationMode: { ...response.collaborationMode, extra: true }
    })).toThrow();
  });

  it("parses Codex 0.144 thread/resume initial turns page", () => {
    const parsed = parseAppServerResumeThreadResponse({
      thread: {
        id: "thread-456",
        preview: "",
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
        section: null,
        sectionEnteredAt: null
      },
      model: "gpt-5.5",
      cwd: "/tmp/workspace",
      approvalPolicy: "never",
      sandbox: { type: "dangerFullAccess" },
      reasoningEffort: "medium",
      turnsBackwardsCursor: null,
      itemsBackwardsCursor: null,
      initialTurnsPage: {
        data: [
          {
            id: "turn-1",
            status: "completed",
            items: []
          }
        ],
        nextCursor: null,
        backwardsCursor: "newer-turns"
      }
    });

    expect(parsed.initialTurnsPage?.data[0]?.id).toBe("turn-1");
    expect(parsed.initialTurnsPage?.backwardsCursor).toBe("newer-turns");
    expect(parsed.turnsBackwardsCursor).toBeNull();
    expect(parsed.itemsBackwardsCursor).toBeNull();
    expect(parsed.thread.section).toBeNull();
    expect(parsed.thread.sectionEnteredAt).toBeNull();
  });
});
