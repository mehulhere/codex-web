import { createServer, get, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { closeHttpServer } from "../src/http-shutdown.js";

describe("HTTP shutdown", () => {
  it.each([false, true])("closes a streaming connection (stalled=%s)", async (stalled) => {
    const streams = new Set<ServerResponse>();
    const server = createServer((_req, res) => {
      if (!stalled) streams.add(res);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: {}\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = z.object({
      address: z.string(), family: z.string(), port: z.number()
    }).strict().parse(server.address());
    const request = get(`http://127.0.0.1:${port}/`, { agent: false });
    const response = await new Promise<IncomingMessage>((resolve) => request.once("response", resolve));
    response.on("error", () => {});
    response.resume();
    const forceClose = vi.spyOn(server, "closeAllConnections");
    try {
      await closeHttpServer(server, streams, 20);
      expect(forceClose).toHaveBeenCalledTimes(stalled ? 1 : 0);
    } finally {
      request.destroy();
      server.closeAllConnections();
      server.close();
    }
  });
});
