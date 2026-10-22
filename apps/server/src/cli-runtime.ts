import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CliDecisionSchema, CliQuestionSchema, CliRequestReplySchema,
  JsonValueSchema, type CliPendingRequest
} from "@farfield/protocol";

export const CliOnlySettingSchema = z.enum(["true", "false"]).default("false")
  .transform(value => value === "true");
const base = {
  threadId: z.string().min(1), turnId: z.string().min(1), itemId: z.string().min(1)
};
const commandParams = z.object({
  ...base, startedAtMs: z.number().int().nonnegative(),
  command: z.string().nullable().optional(), cwd: z.string().nullable().optional(),
  reason: z.string().nullable().optional(), approvalId: z.string().nullable().optional(),
  kind: z.enum(["command", "writeStdin"]).optional(), environmentId: z.string().nullable().optional(),
  availableDecisions: z.array(JsonValueSchema).nullable().optional(),
  commandActions: z.array(JsonValueSchema).nullable().optional(),
  additionalPermissions: JsonValueSchema.optional(), networkApprovalContext: JsonValueSchema.optional(),
  proposedExecpolicyAmendment: z.array(z.string()).nullable().optional(),
  proposedNetworkPolicyAmendments: z.array(JsonValueSchema).nullable().optional()
}).strict();
const fileParams = z.object({
  ...base, startedAtMs: z.number().int().nonnegative(),
  reason: z.string().nullable().optional(), grantRoot: z.string().nullable().optional()
}).strict();
const questionParams = z.object({
  ...base, questions: z.array(CliQuestionSchema), isBlocking: z.boolean(),
  autoResolutionMs: z.number().int().nonnegative().nullable().optional()
}).strict();
const rpcId = z.union([z.string(), z.number().int()]);
const RequestSchema = z.discriminatedUnion("method", [
  z.object({ id: rpcId, method: z.literal("item/commandExecution/requestApproval"), params: commandParams }).strict(),
  z.object({ id: rpcId, method: z.literal("item/fileChange/requestApproval"), params: fileParams }).strict(),
  z.object({ id: rpcId, method: z.literal("item/tool/requestUserInput"), params: questionParams }).strict()
]);
type Pending = {
  rpcId: z.infer<typeof rpcId>;
  view: CliPendingRequest;
  resolve: (reply: z.infer<typeof CliRequestReplySchema>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Holds only outstanding requests from this app-server process; never persists approvals. */
export class CliRequestRegistry {
  private readonly pending = new Map<string, Pending>();
  public constructor(private readonly onChange: (threadId: string) => void) {}

  public async receive(value: unknown): Promise<z.infer<typeof CliRequestReplySchema>> {
    const request = RequestSchema.parse(value);
    if (this.pending.size >= 128) throw new Error("Too many pending CLI requests");
    const params = request.params;
    let decisions: CliPendingRequest["decisions"] = [];
    if (request.method === "item/commandExecution/requestApproval") {
      decisions = (request.params.availableDecisions ?? ["accept", "decline", "cancel"])
        .flatMap(value => { const result = CliDecisionSchema.safeParse(value); return result.success ? [result.data] : []; });
      if (!decisions.length) throw new Error("CLI approval offers no supported decision");
    } else if (request.method === "item/fileChange/requestApproval") {
      decisions = ["accept", "decline", "cancel"];
    }
    const view: CliPendingRequest = {
      id: randomUUID(), threadId: params.threadId, turnId: params.turnId,
      kind: request.method === "item/tool/requestUserInput" ? "questions"
        : request.method === "item/fileChange/requestApproval" ? "file-change" : "command",
      reason: "reason" in params ? params.reason ?? null : null,
      command: request.method === "item/commandExecution/requestApproval" ? request.params.command ?? null : null,
      cwd: request.method === "item/commandExecution/requestApproval" ? request.params.cwd ?? null : null,
      details: request.method === "item/tool/requestUserInput" ? null : JSON.stringify(request.params, null, 2),
      decisions, questions: request.method === "item/tool/requestUserInput" ? request.params.questions : []
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(view.id, "CLI request expired"), 10 * 60_000);
      timer.unref();
      this.pending.set(view.id, { rpcId: request.id, view, resolve, reject, timer });
      this.onChange(view.threadId);
    });
  }

  public list(threadId: string): CliPendingRequest[] {
    return [...this.pending.values()].filter(entry => entry.view.threadId === threadId).map(entry => entry.view);
  }

  public respond(threadId: string, id: string, value: unknown): void {
    const pending = this.pending.get(id);
    if (!pending || pending.view.threadId !== threadId) throw new Error("CLI request is no longer pending in this chat");
    const reply = CliRequestReplySchema.parse(value);
    if (pending.view.kind === "questions") {
      if (!("answers" in reply)) throw new Error("CLI request requires answers");
      const expected = pending.view.questions.map(q => q.id).sort();
      if (JSON.stringify(Object.keys(reply.answers).sort()) !== JSON.stringify(expected)) {
        throw new Error("Answers must match the pending questions");
      }
    } else if (!("decision" in reply) || !pending.view.decisions.includes(reply.decision)) {
      throw new Error("Decision is not offered by this CLI request");
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(reply);
    this.onChange(threadId);
  }

  private cancel(id: string, reason: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(new Error(reason));
    this.onChange(pending.view.threadId);
  }
  public cancelTurn(threadId: string, turnId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.view.threadId === threadId && pending.view.turnId === turnId) this.cancel(id, "CLI turn completed");
    }
  }
  public close(): void {
    for (const id of this.pending.keys()) this.cancel(id, "CLI transport closed");
  }
  public resolveRequest(threadId: string, requestId: string | number): void {
    for (const [id, pending] of this.pending) {
      if (pending.view.threadId === threadId && pending.rpcId === requestId) this.cancel(id, "CLI request was resolved");
    }
  }
}
