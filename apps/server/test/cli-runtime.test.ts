import { describe, expect, it } from "vitest";
import { CliRequestRegistry, CliOnlySettingSchema } from "../src/cli-runtime.js";

const command = {
  id: 7, method: "item/commandExecution/requestApproval",
  params: { threadId: "thread-test", turnId: "turn-test", itemId: "item-test", startedAtMs: 1,
    command: "node --version", availableDecisions: ["accept", "decline"] }
};

describe("CLI-only mode", () => {
  it("is off by default and requires an explicit valid opt-in", () => {
    expect(CliOnlySettingSchema.parse(undefined)).toBe(false);
    expect(CliOnlySettingSchema.parse("false")).toBe(false);
    expect(CliOnlySettingSchema.parse("true")).toBe(true);
    expect(() => CliOnlySettingSchema.parse("flase")).toThrow();
    expect(() => CliOnlySettingSchema.parse("1")).toThrow();
  });
  it("waits for explicit approval, scopes replies to their chat and accepts only offered decisions", async () => {
    const registry = new CliRequestRegistry(() => undefined);
    const response = registry.receive(command);
    const request = registry.list("thread-test")[0]!;
    expect(registry.list("another-chat")).toEqual([]);
    expect(() => registry.respond("another-chat", request.id, { decision: "accept" })).toThrow();
    expect(() => registry.respond("thread-test", request.id, { decision: "acceptForSession" })).toThrow();
    expect(registry.list("thread-test")).toHaveLength(1);
    registry.respond("thread-test", request.id, { decision: "accept" });
    await expect(response).resolves.toEqual({ decision: "accept" });
    expect(registry.list("thread-test")).toEqual([]);
    expect(() => registry.respond("thread-test", request.id, { decision: "accept" })).toThrow();
  });
  it("validates questions and replies, including string RPC ids", async () => {
    const registry = new CliRequestRegistry(() => undefined);
    const response = registry.receive({ id: "rpc-1", method: "item/tool/requestUserInput", params: {
      threadId: "thread-test", turnId: "turn-test", itemId: "item-test", isBlocking: true,
      questions: [{ id: "choice", header: "Choice", question: "Which?", options: null }]
    } });
    const request = registry.list("thread-test")[0]!;
    expect(() => registry.respond("thread-test", request.id, { answers: { wrong: { answers: ["x"] } } })).toThrow();
    registry.respond("thread-test", request.id, { answers: { choice: { answers: ["selected"] } } });
    await expect(response).resolves.toEqual({ answers: { choice: { answers: ["selected"] } } });
  });
  it("clears requests on completion or transport loss without allowing stale approvals", async () => {
    const registry = new CliRequestRegistry(() => undefined);
    const pending = registry.receive(command);
    const failure = expect(pending).rejects.toThrow(/completed/);
    registry.cancelTurn("thread-test", "turn-test");
    await failure;
    expect(registry.list("thread-test")).toEqual([]);
    const pending2 = registry.receive(command);
    const failure2 = expect(pending2).rejects.toThrow(/closed/);
    registry.close();
    await failure2;
    expect(registry.list("thread-test")).toEqual([]);
  });
  it("rejects unsupported requests and malformed command payloads", async () => {
    const registry = new CliRequestRegistry(() => undefined);
    await expect(registry.receive({ ...command, method: "item/tool/call" })).rejects.toThrow();
    await expect(registry.receive({ ...command, params: { ...command.params, injected: true } })).rejects.toThrow();
    expect(registry.list("thread-test")).toEqual([]);
  });
  it("handles terminal-input approvals and clears server-resolved requests", async () => {
    const registry = new CliRequestRegistry(() => undefined);
    const pending = registry.receive({ ...command, id: -4, params: { ...command.params, kind: "writeStdin" } });
    const failure = expect(pending).rejects.toThrow(/resolved/);
    registry.resolveRequest("another-chat", -4);
    expect(registry.list("thread-test")).toHaveLength(1);
    registry.resolveRequest("thread-test", -4);
    await failure;
    expect(registry.list("thread-test")).toEqual([]);
  });
});
