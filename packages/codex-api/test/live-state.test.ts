import { describe, expect, it } from "vitest";
import { parseThreadStreamStateChangedBroadcast } from "@farfield/protocol";
import {
  applyStrictPatch,
  reduceThreadStreamEvents,
  ThreadStreamReductionError,
  ThreadStreamStateAccumulator
} from "../src/live-state.js";

describe("live-state reducer", () => {
  it("rejects inherited patch paths without changing global prototypes", () => {
    try {
      expect(() => applyStrictPatch({ id: "thread-1", turns: [], requests: [] }, {
        op: "add", path: ["__proto__", "__codexAuditProbe"], value: "unexpected"
      })).toThrow(/path segment missing/);
      expect(Object.hasOwn(Object.prototype, "__codexAuditProbe")).toBe(false);
    } finally {
      Reflect.deleteProperty(Object.prototype, "__codexAuditProbe");
    }
  });

  it("rejects out-of-range array insertions instead of clamping them", () => {
    expect(() => applyStrictPatch({ id: "thread-1", turns: [], requests: [] }, {
      op: "add", path: ["turns", 99], value: { id: "turn-1", status: "completed", items: [] }
    })).toThrow(/index out of range/);
  });

  it("does not remove inherited properties as if they were state fields", () => {
    expect(() => applyStrictPatch({ id: "thread-1", turns: [], requests: [] }, {
      op: "remove", path: ["toString"]
    })).toThrow(/key missing/);
  });

  it("returns cached state without replaying stream events on every read", () => {
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-cache",
      version: 11,
      params: {
        conversationId: "thread-cache",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            id: "thread-cache",
            title: "Before",
            turns: [
              {
                status: "inProgress",
                items: [
                  {
                    id: "todo-cache",
                    type: "todo-list",
                    explanation: "Keep the implementation focused.",
                    plan: [
                      { step: "Add strict schemas", status: "inProgress" },
                      { step: "Verify the live route", status: "pending" }
                    ]
                  },
                  {
                    id: "error-cache",
                    type: "error",
                    message: "The response stream disconnected.",
                    willRetry: true,
                    errorInfo: {
                      responseStreamDisconnected: {
                        httpStatusCode: null
                      }
                    },
                    additionalDetails: "The request will retry."
                  }
                ]
              }
            ],
            requests: []
          }
        }
      }
    });
    const patchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-cache",
      version: 11,
      params: {
        conversationId: "thread-cache",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: [
            {
              op: "replace",
              path: ["title"],
              value: "After"
            }
          ]
        }
      }
    });

    const accumulator = new ThreadStreamStateAccumulator();
    accumulator.ingest(snapshotEvent);
    accumulator.ingest(patchEvent);

    const firstRead = accumulator.get("thread-cache");
    const secondRead = accumulator.get("thread-cache");
    expect(secondRead).toBe(firstRead);
    expect(firstRead?.conversationState?.title).toBe("After");
  });

  it("accepts a patch that clears runtime workspace roots with null", () => {
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-null-roots",
      version: 11,
      params: {
        conversationId: "thread-null-roots",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            id: "thread-null-roots",
            turns: [
              {
                status: "inProgress",
                params: {
                  threadId: "thread-null-roots",
                  input: [],
                  runtimeWorkspaceRoots: ["/workspace"]
                },
                items: []
              }
            ],
            requests: []
          }
        }
      }
    });
    const patchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-null-roots",
      version: 11,
      params: {
        conversationId: "thread-null-roots",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: [
            {
              op: "replace",
              path: ["turns", 0, "params", "runtimeWorkspaceRoots"],
              value: null
            }
          ]
        }
      }
    });

    const accumulator = new ThreadStreamStateAccumulator();
    accumulator.ingest(snapshotEvent);
    expect(() => accumulator.ingest(patchEvent)).not.toThrow();
    expect(accumulator.isQuarantined("thread-null-roots")).toBe(false);
    expect(
      accumulator.get("thread-null-roots")?.conversationState?.turns[0]?.params
        ?.runtimeWorkspaceRoots
    ).toBeNull();
  });

  it("omits a provisional canonical tail turn until Desktop commits its turn ID", () => {
    const tailKey = "tail:0:local:00000000-0000-4000-8000-000000000004";
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-tail",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            id: "thread-tail",
            turns: [],
            requests: [],
            turnHistory: {
              kind: "canonical",
              history: {
                entitiesByKey: {},
                generation: 1,
                isComplete: true,
                islands: [
                  {
                    id: "tail:1",
                    entries: [],
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
    const addProvisionalTurnEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-tail",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: [
            {
              op: "add",
              path: ["turnHistory", "history", "entitiesByKey", tailKey],
              value: {
                params: {
                  threadId: "thread-tail",
                  clientUserMessageId: "client-message-tail",
                  input: [{ type: "text", text: "Desktop prompt", text_elements: [] }],
                  commentAttachments: [],
                  cwd: "/workspace",
                  model: null,
                  effort: null,
                  multiAgentMode: "explicitRequestOnly",
                  serviceTier: null,
                  approvalPolicy: "never",
                  approvalsReviewer: "user",
                  permissions: ":danger-full-access",
                  runtimeWorkspaceRoots: ["/workspace"],
                  attachments: [],
                  collaborationMode: {
                    mode: "default",
                    settings: {
                      reasoning_effort: "high",
                      model: "gpt-5.5",
                      developer_instructions: null
                    }
                  },
                  summary: "Desktop prompt",
                  sandboxPolicy: { type: "dangerFullAccess" },
                  useAppServerPermissionDefault: false,
                  personality: "friendly",
                  outputSchema: null
                },
                turnId: null,
                status: "inProgress",
                turnStartedAtMs: 1,
                durationMs: null,
                finalAssistantStartedAtMs: null,
                error: null,
                diff: null,
                items: [
                  {
                    id: "command-tail",
                    type: "commandExecution",
                    command: "pwd",
                    cwd: "/workspace",
                    status: "completed",
                    source: "tool",
                    aggregatedOutput: "/workspace",
                    exitCode: 0,
                    durationMs: 1
                  }
                ]
              }
            }
          ]
        }
      }
    });
    const addIslandEntryEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-tail",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 2,
          revision: 3,
          patches: [
            {
              op: "add",
              path: ["turnHistory", "history", "islands", 0, "entries", 0],
              value: { key: tailKey, value: tailKey }
            }
          ]
        }
      }
    });
    const commitTurnIdEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-tail",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 3,
          revision: 4,
          patches: [
            {
              op: "replace",
              path: ["turnHistory", "history", "entitiesByKey", tailKey, "turnId"],
              value: "turn-tail"
            }
          ]
        }
      }
    });

    const provisionalState = reduceThreadStreamEvents([
      snapshotEvent,
      addProvisionalTurnEvent,
      addIslandEntryEvent
    ]);
    expect(provisionalState.get("thread-tail")?.conversationState?.turns).toEqual([]);

    const committedState = reduceThreadStreamEvents([
      snapshotEvent,
      addProvisionalTurnEvent,
      addIslandEntryEvent,
      commitTurnIdEvent
    ]);
    expect(committedState.get("thread-tail")?.conversationState?.turns).toEqual([
      expect.objectContaining({
        turnId: "turn-tail",
        status: "inProgress",
        items: [
          expect.objectContaining({
            type: "commandExecution",
            source: "tool"
          })
        ]
      })
    ]);
  });

  it("keeps reducing provisional Desktop turns when permissions are null", () => {
    const tailKey = "tail:1:local:00000000-0000-4000-8000-000000000005";
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-null-permissions",
      version: 11,
      params: {
        conversationId: "thread-null-permissions",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 4,
          conversationState: {
            id: "thread-null-permissions",
            turns: [],
            requests: [],
            turnHistory: {
              kind: "canonical",
              history: {
                entitiesByKey: {},
                generation: 1,
                isComplete: true,
                islands: [
                  {
                    id: "tail:1",
                    entries: [],
                    olderBoundary: { status: "exhausted", boundaryId: "tail:1:older" },
                    newerBoundary: { status: "exhausted", boundaryId: "tail:1:newer" }
                  }
                ]
              }
            }
          }
        }
      }
    });
    const addTurnEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-null-permissions",
      version: 11,
      params: {
        conversationId: "thread-null-permissions",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 4,
          revision: 5,
          patches: [
            {
              op: "add",
              path: ["turnHistory", "history", "entitiesByKey", tailKey],
              value: {
                params: {
                  threadId: "thread-null-permissions",
                  input: [{ type: "text", text: "hello" }],
                  permissions: null
                },
                turnId: null,
                status: "inProgress",
                turnStartedAtMs: 1,
                durationMs: null,
                finalAssistantStartedAtMs: null,
                error: null,
                diff: null,
                items: []
              }
            },
            {
              op: "add",
              path: ["turnHistory", "history", "islands", 0, "entries", 0],
              value: { key: tailKey, value: tailKey }
            }
          ]
        }
      }
    });
    const commitTurnEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-null-permissions",
      version: 11,
      params: {
        conversationId: "thread-null-permissions",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 5,
          revision: 6,
          patches: [
            {
              op: "replace",
              path: ["turnHistory", "history", "entitiesByKey", tailKey, "turnId"],
              value: "turn-null-permissions"
            }
          ]
        }
      }
    });
    const addCompactionEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-null-permissions",
      version: 11,
      params: {
        conversationId: "thread-null-permissions",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 6,
          revision: 7,
          patches: [
            {
              op: "add",
              path: ["turnHistory", "history", "entitiesByKey", tailKey, "items", 0],
              value: {
                id: "compaction-null-permissions",
                type: "contextCompaction",
                completed: false,
                source: "automatic"
              }
            }
          ]
        }
      }
    });

    const accumulator = new ThreadStreamStateAccumulator();
    accumulator.ingest(snapshotEvent);
    accumulator.ingest(addTurnEvent);
    accumulator.ingest(commitTurnEvent);
    accumulator.ingest(addCompactionEvent);

    expect(accumulator.get("thread-null-permissions")?.conversationState?.turns).toEqual([
      expect.objectContaining({
        turnId: "turn-null-permissions",
        params: expect.objectContaining({ permissions: null }),
        items: [
          expect.objectContaining({
            type: "contextCompaction",
            source: "automatic"
          })
        ]
      })
    ]);
  });

  it("applies snapshot then patches", () => {
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-1",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
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
          }
        }
      }
    });

    const patchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-1",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: [
            {
              op: "replace",
              path: ["requests"],
              value: [
                {
                  method: "item/tool/requestUserInput",
                  id: 3,
                  params: {
                    threadId: "thread-1",
                    turnId: "turn-2",
                    itemId: "item-9",
                    questions: [
                      {
                        id: "q1",
                        header: "Header",
                        question: "Choose",
                        isOther: true,
                        isSecret: false,
                        options: [
                          {
                            label: "A",
                            description: "A desc"
                          }
                        ]
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    });

    const state = reduceThreadStreamEvents([snapshotEvent, patchEvent]);
    const thread = state.get("thread-1");

    expect(thread?.conversationState?.requests.length).toBe(1);
  });

  it("applies every patch in one event before strictly validating the resulting state", () => {
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-atomic",
      version: 11,
      params: {
        conversationId: "thread-atomic",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            id: "thread-atomic",
            title: "Before",
            turns: [],
            requests: []
          }
        }
      }
    });
    const atomicPatchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-atomic",
      version: 11,
      params: {
        conversationId: "thread-atomic",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: [
            { op: "remove", path: ["id"] },
            { op: "add", path: ["id"], value: "thread-atomic" },
            { op: "replace", path: ["title"], value: "After" }
          ]
        }
      }
    });

    const accumulator = new ThreadStreamStateAccumulator();
    accumulator.ingest(snapshotEvent);

    expect(() => accumulator.ingest(atomicPatchEvent)).not.toThrow();
    expect(accumulator.get("thread-atomic")?.conversationState?.title).toBe("After");
  });

  it("keeps reducer alive when patches arrive before snapshot", () => {
    const patchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-2",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 0,
          revision: 1,
          patches: [
            {
              op: "add",
              path: ["turns", 0],
              value: {
                status: "inProgress",
                items: []
              }
            }
          ]
        }
      }
    });

    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-2",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: {
            id: "thread-2",
            turns: [],
            requests: []
          }
        }
      }
    });

    const state = reduceThreadStreamEvents([patchEvent, snapshotEvent]);
    const thread = state.get("thread-2");

    expect(thread?.conversationState?.id).toBe("thread-2");
    expect(thread?.conversationState?.turns.length).toBe(0);
  });

  it("clears transient revisions when the Desktop IPC session ends", () => {
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-before-restart",
      version: 11,
      params: {
        conversationId: "thread-restarted",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 147,
          conversationState: {
            id: "thread-restarted",
            turns: [],
            requests: []
          }
        }
      }
    });

    const accumulator = new ThreadStreamStateAccumulator();
    accumulator.ingest(snapshotEvent);

    expect(accumulator.clear()).toBe(1);
    expect(accumulator.get("thread-restarted")).toBeUndefined();
    expect(accumulator.isQuarantined("thread-restarted")).toBe(false);
  });

  it("throws reduction error with raw payload details when patch introduces invalid item type", () => {
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-3",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            id: "thread-3",
            turns: [
              {
                status: "completed",
                items: [
                  {
                    id: "item-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "hello" }]
                  }
                ]
              }
            ],
            requests: []
          }
        }
      }
    });

    const patchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-3",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: [
            {
              op: "replace",
              path: ["turns", 0, "items", 0],
              value: {
                id: "item-2",
                type: "newUnknownItemType"
              }
            }
          ]
        }
      }
    });

    let captured: unknown;
    try {
      reduceThreadStreamEvents([snapshotEvent, patchEvent]);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ThreadStreamReductionError);
    const reductionError = captured as ThreadStreamReductionError;
    expect(reductionError.details.threadId).toBe("thread-3");
    expect(reductionError.details.eventIndex).toBe(1);
    expect(reductionError.details.patchIndex).toBe(0);
    expect(reductionError.details.event.params.conversationId).toBe("thread-3");
    expect(reductionError.details.patch.op).toBe("replace");
  });

  it("quarantines patches after a reduction failure until a fresh snapshot arrives", () => {
    const snapshot = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-quarantine",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            id: "thread-quarantine",
            turns: [],
            requests: []
          }
        }
      }
    });
    const invalidPatch = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-quarantine",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: [{ op: "replace", path: ["turns", 14], value: { status: "completed", items: [] } }]
        }
      }
    });
    const laterPatch = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-quarantine",
        hostId: "local",
        change: {
          type: "patches",
          baseRevision: 2,
          revision: 3,
          patches: [{ op: "replace", path: ["turns", 15], value: { status: "completed", items: [] } }]
        }
      }
    });
    const recoverySnapshot = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 11,
      params: {
        conversationId: "thread-quarantine",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 4,
          conversationState: {
            id: "thread-quarantine",
            title: "Recovered",
            turns: [],
            requests: []
          }
        }
      }
    });

    const accumulator = new ThreadStreamStateAccumulator();
    accumulator.ingest(snapshot);
    expect(() => accumulator.ingest(invalidPatch)).toThrow(ThreadStreamReductionError);
    expect(accumulator.isQuarantined("thread-quarantine")).toBe(true);
    expect(() => accumulator.ingest(laterPatch)).not.toThrow();
    expect(accumulator.get("thread-quarantine")?.conversationState?.turns).toHaveLength(0);

    accumulator.ingest(recoverySnapshot);
    expect(accumulator.isQuarantined("thread-quarantine")).toBe(false);
    expect(accumulator.get("thread-quarantine")?.conversationState?.title).toBe("Recovered");
  });
});
