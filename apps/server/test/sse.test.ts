import { createServer, get, IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { encodeSseEvent, registerSseClient, writeSseEvent } from "../src/sse.js";

describe("encodeSseEvent", () => {
    it("keeps streaming after the GET request ends and releases clients on response close", async () => {
        const clients = new Set<ServerResponse>();
        const server = createServer((req, res) => {
            req.resume();
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            registerSseClient(clients, res);
            writeSseEvent(res, encodeSseEvent({ type: "state" }));
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = z.object({
            address: z.string(), family: z.string(), port: z.number()
        }).strict().parse(server.address());
        const request = get(`http://127.0.0.1:${port}/events`, { agent: false });
        try {
            const stream = await new Promise<IncomingMessage>((resolve) => request.once("response", resolve));
            await new Promise<void>((resolve) => stream.once("data", () => resolve()));
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(clients.size).toBe(1);
            const next = new Promise<string>((resolve) =>
                stream.once("data", (chunk: Buffer) => resolve(chunk.toString()))
            );
            for (const client of clients) writeSseEvent(client, encodeSseEvent({ type: "history", entry: null }));
            expect(await next).toContain('"entry":null');
            const closed = new Promise<void>((resolve) => server.close(() => resolve()));
            for (const client of clients) client.end();
            await closed;
            expect(clients.size).toBe(0);
        } finally {
            request.destroy();
            server.closeAllConnections();
            server.close();
        }
    });
    it("closes a stalled stream before its output queue can grow beyond the budget", () => {
        const response = new ServerResponse(new IncomingMessage(new Socket()));
        vi.spyOn(response, "writableLength", "get").mockReturnValue(256 * 1024);
        const destroy = vi.spyOn(response, "destroy");
        const write = vi.spyOn(response, "write");
        expect(writeSseEvent(response, "data: {}\n\n")).toBe(false);
        expect(destroy).toHaveBeenCalledOnce();
        expect(write).not.toHaveBeenCalled();
    });

    it("allows ordinary backpressure within the budget without disconnecting", () => {
        const response = new ServerResponse(new IncomingMessage(new Socket()));
        vi.spyOn(response, "write").mockReturnValue(false);
        const destroy = vi.spyOn(response, "destroy");
        expect(writeSseEvent(response, "data: {}\n\n")).toBe(true);
        expect(destroy).not.toHaveBeenCalled();
    });
    it("encodes a named live-state notification without conversation payloads", () => {
        expect(encodeSseEvent(
            { type: "thread-live-state-changed", threadId: "thread-1" },
            "thread-live-state-changed"
        )).toBe(
            "event: thread-live-state-changed\n" +
            "data: {\"type\":\"thread-live-state-changed\",\"threadId\":\"thread-1\"}\n\n"
        );
    });
});
