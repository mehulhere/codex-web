import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const ToolListSchema = z.object({ tools: z.array(z.object({ name: z.string(), namespace: z.string() })) });
const ToolResultSchema = z.object({ success: z.boolean(), contentItems: z.array(z.object({ type: z.literal("inputText"), text: z.string() }).strict()) }).strict();
const WindowSchema = z.object({ usedPercent: z.number().min(0).max(100) });
const LimitsSchema = z.object({ primary: WindowSchema.nullable().optional(), secondary: WindowSchema.nullable().optional() });
const UsageSchema = z.object({
  rateLimits: LimitsSchema.nullable().optional(),
  rateLimitsByLimitId: z.record(z.string(), LimitsSchema).nullable().optional(),
  rateLimitResetCredits: z.object({ availableCount: z.number().int().nonnegative() }).nullable().optional()
});
export const UsageResetStatusSchema = z.object({
  available: z.boolean(), availableCount: z.number().int().nonnegative(), eligible: z.boolean(),
  fiveHourRemaining: z.number().min(0).max(100).nullable(), weeklyRemaining: z.number().min(0).max(100).nullable(),
  reason: z.string().nullable()
}).strict();
export type UsageResetStatus = z.infer<typeof UsageResetStatusSchema>;
export const ConsumeUsageResetBodySchema = z.object({
  threadId: z.string().min(1), idempotencyKey: z.string().uuid(), confirmed: z.literal(true)
}).strict();

type ToolArguments = Record<string, string>;

export async function requestDesktopPipe<Result>(endpoint: string, method: string,
  params: object, schema: z.ZodType<Result>, timeoutMs = 60_000): Promise<Result> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let data = Buffer.alloc(0);
    let done = false;
    const finish = (error: Error | null, result?: Result): void => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) reject(error);
      else if (result !== undefined) resolve(result);
      else reject(new Error("Desktop returned no result"));
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("Desktop reset request timed out. Retry the same attempt.")));
    socket.on("error", error => finish(error));
    socket.on("close", () => { if (!done) finish(new Error("Desktop reset connection closed. Retry the same attempt.")); });
    socket.on("connect", () => {
      const body = Buffer.from(JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }));
      const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on("data", chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length < 4) return;
      const size = data.readUInt32LE(0);
      if (size > 8 * 1024 * 1024) { finish(new Error("Desktop usage response exceeded the size limit")); return; }
      if (data.length < size + 4) return;
      try {
        const value = JSON.parse(data.subarray(4, size + 4).toString("utf8"));
        const failure = z.object({ error: z.object({ code: z.number(), message: z.string() }) }).safeParse(value);
        if (failure.success) { finish(new Error(failure.data.error.message)); return; }
        const response = z.object({ id: z.literal(1), jsonrpc: z.literal("2.0"), result: schema }).strict().parse(value);
        finish(null, response.result);
      } catch (error) { finish(z.instanceof(Error).parse(error)); }
    });
  });
}

export class DesktopUsageResets {
  public constructor(private readonly endpoint?: string) {}

  private async resolveEndpoint(): Promise<string> {
    if (this.endpoint) return this.endpoint;
    const directory = path.join(os.tmpdir(), "codex-browser-use");
    const configured = process.env["CODEX_APP_TOOLS_PIPE_PATH"];
    const entries = await fs.readdir(directory).catch(() => []);
    const candidates = [...new Set([...(configured ? [configured] : []), ...entries.filter(name => name.endsWith(".sock")).map(name => path.join(directory, name))])];
    for (const candidate of candidates) {
      const stat = await fs.stat(candidate).catch(() => null);
      if (!stat || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) continue;
      try {
        const catalog = await requestDesktopPipe(candidate, "tools/list", { threadStartKind: "all" }, ToolListSchema, 3_000);
        if (catalog.tools.some(tool => tool.name === "get_usage_limits" && tool.namespace === "codex_app") &&
          catalog.tools.some(tool => tool.name === "consume_usage_reset" && tool.namespace === "codex_app")) return candidate;
      } catch { continue; }
    }
    throw new Error("Open Codex Desktop to manage usage resets");
  }

  private async call(endpoint: string, threadId: string, tool: "get_usage_limits" | "consume_usage_reset", args: ToolArguments) {
    const result = await requestDesktopPipe(endpoint, "tools/call", {
      arguments: args, callerSource: "codex", namespace: "codex_app", hostId: "local", threadId,
      tool, callId: randomUUID(), turnId: randomUUID()
    }, ToolResultSchema);
    const text = result.contentItems.map(item => item.text).join("\n");
    if (!result.success) throw new Error(text || "Desktop reset request was not confirmed");
    return text;
  }

  private async read(endpoint: string, threadId: string): Promise<UsageResetStatus> {
    const usage = UsageSchema.parse(JSON.parse(await this.call(endpoint, threadId, "get_usage_limits", {})));
    const limits = usage.rateLimitsByLimitId?.["codex"] ?? usage.rateLimits;
    const primary = limits?.primary?.usedPercent;
    const secondary = limits?.secondary?.usedPercent;
    const eligible = (primary !== undefined && primary >= 90) || (secondary !== undefined && secondary >= 90);
    const available = usage.rateLimitResetCredits !== undefined && usage.rateLimitResetCredits !== null;
    return UsageResetStatusSchema.parse({ available, availableCount: usage.rateLimitResetCredits?.availableCount ?? 0,
      eligible, fiveHourRemaining: primary === undefined ? null : 100 - primary,
      weeklyRemaining: secondary === undefined ? null : 100 - secondary,
      reason: !available ? "Reset balance is unavailable. Check Codex Desktop." : eligible ? null : "A reset is available when the 5-hour or weekly limit has 10% or less remaining." });
  }

  public async status(threadId: string): Promise<UsageResetStatus> {
    const endpoint = await this.resolveEndpoint();
    return this.read(endpoint, threadId);
  }

  public async consume(input: z.infer<typeof ConsumeUsageResetBodySchema>): Promise<{ status: UsageResetStatus; message: string }> {
    const confirmed = ConsumeUsageResetBodySchema.parse(input);
    const endpoint = await this.resolveEndpoint();
    // Desktop checks fresh eligibility and deduplicates this key, including uncertain retries.
    await this.call(endpoint, confirmed.threadId, "consume_usage_reset", { idempotencyKey: confirmed.idempotencyKey });
    const status = await this.read(endpoint, confirmed.threadId);
    return { status, message: "Reset request completed. Usage has been refreshed." };
  }
}
