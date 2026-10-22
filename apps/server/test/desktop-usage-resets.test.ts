import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ConsumeUsageResetBodySchema, DesktopUsageResets } from "../src/desktop-usage-resets.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const operation of cleanup.splice(0)) await operation(); });
const RequestSchema = z.object({ id: z.number(), method: z.string(), params: z.object({
  tool: z.string(), arguments: z.record(z.string(), z.string())
}).passthrough() }).passthrough();

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pwa-reset-test-"));
  const endpoint = path.join(directory, "tools.sock");
  const calls: Array<{ tool: string; arguments: Record<string, string> }> = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4 || buffer.length < buffer.readUInt32LE(0) + 4) return;
      const request = RequestSchema.parse(JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32LE(0)).toString()));
      calls.push(request.params);
      const text = request.params.tool === "get_usage_limits" ? JSON.stringify({
        rateLimitsByLimitId: { codex: { primary: { usedPercent: 95 }, secondary: { usedPercent: 40 } } },
        rateLimitResetCredits: { availableCount: 3 }
      }) : "Reset request processed";
      const body = Buffer.from(JSON.stringify({ id: request.id, jsonrpc: "2.0", result: {
        success: true, contentItems: [{ type: "inputText", text }]
      } }));
      const header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(Buffer.concat([header, body]));
    });
  });
  server.listen(endpoint); await once(server, "listening");
  cleanup.push(async () => { server.close(); await once(server, "close"); await fs.rm(directory, { recursive: true, force: true }); });
  return { service: new DesktopUsageResets(endpoint), calls };
}

describe("Desktop usage resets", () => {
  it("reads reset eligibility without consuming credits", async () => {
    const { service, calls } = await fixture();
    expect(await service.status("test-chat")).toMatchObject({ availableCount: 3, eligible: true, fiveHourRemaining: 5, weeklyRemaining: 60 });
    expect(calls.map(call => call.tool)).toEqual(["get_usage_limits"]);
  });

  it("requires explicit confirmation before calling Desktop", () => {
    expect(() => ConsumeUsageResetBodySchema.parse({ threadId: "test-chat", idempotencyKey: "00000000-0000-4000-8000-000000000001", confirmed: false })).toThrow();
  });

  it("preserves the exact idempotency key for an uncertain retry", async () => {
    const { service, calls } = await fixture();
    const input = { threadId: "test-chat", idempotencyKey: "00000000-0000-4000-8000-000000000001", confirmed: true as const };
    await service.consume(input); await service.consume(input);
    expect(calls.filter(call => call.tool === "consume_usage_reset").map(call => call.arguments)).toEqual([
      { idempotencyKey: input.idempotencyKey }, { idempotencyKey: input.idempotencyKey }
    ]);
  });
});
