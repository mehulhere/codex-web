import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net, { type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { parseIpcFrame, type IpcFrame } from "@farfield/protocol";
import { describe, expect, it, vi } from "vitest";
import { IpcFrameDecoder } from "../src/ipc-frame-decoder.js";
import {
  DesktopIpcClient,
  type IpcConnectionState
} from "../src/ipc-client.js";

function encode(body: string): Buffer {
  const data = Buffer.from(body);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length);
  return Buffer.concat([header, data]);
}

async function fixture(handler: (socket: Socket, frame: IpcFrame) => void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "farfield-ipc-"));
  const socketPath = path.join(directory, "ipc.sock");
  const sockets = new Set<Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const decoder = new IpcFrameDecoder(1024 * 1024);
    socket.on("data", chunk => decoder.push(chunk, data => handler(socket, parseIpcFrame(JSON.parse(data.toString())))));
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  const client = new DesktopIpcClient({ socketPath, requestTimeoutMs: 500 });
  await client.connect();
  return { client, async close() {
    for (const socket of sockets) socket.destroy();
    await client.disconnect();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}

describe("DesktopIpcClient connection state", () => {
  for (const operation of ["initialize", "request"]) {
    it(`does not leave an orphaned timeout after disconnected ${operation}`, async () => {
      vi.useFakeTimers();
      try {
        const client = new DesktopIpcClient({ socketPath: "/unused/disconnected.sock" });
        const result = operation === "initialize" ? client.initialize("test") : client.sendRequestAndWait("test", {});
        await expect(result).rejects.toThrow(/not connected/);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });
  }

  it("initializes from fragmented responses and uses the assigned client identity", async () => {
    let resolveBroadcast: (frame: IpcFrame) => void = () => undefined;
    const received = new Promise<IpcFrame>(resolve => {
      resolveBroadcast = resolve;
    });
    const app = await fixture((socket, frame) => {
      if (frame.type !== "request") {
        resolveBroadcast(frame);
        return;
      }
      const response = encode(JSON.stringify({ type: "response", requestId: frame.requestId,
        resultType: "success", result: { clientId: "assigned-client" } }));
      socket.write(response.subarray(0, 2));
      setTimeout(() => socket.write(response.subarray(2)), 1);
    });
    try {
      await app.client.initialize("test");
      app.client.sendBroadcast("test-event", {});
      await expect(received).resolves.toMatchObject({ type: "broadcast", sourceClientId: "assigned-client" });
    } finally { await app.close(); }
  });

  for (const body of ["invalid JSON", JSON.stringify({ type: "unsupported-frame" })]) {
    it(`rejects pending work and disconnects on malformed protocol: ${body}`, async () => {
      const app = await fixture(socket => socket.write(encode(body)));
      try {
        await expect(app.client.sendRequestAndWait("test", {})).rejects.toThrow(/IPC protocol error/);
      } finally { await app.close(); }
    });
  }

  it("rejects invalid initialization without leaving its promise unresolved", async () => {
    const app = await fixture((socket, frame) => {
      if (frame.type !== "request") return;
      socket.write(encode(JSON.stringify({ type: "response", requestId: frame.requestId,
        resultType: "success", result: {} })));
    });
    try {
      await expect(app.client.initialize("test")).rejects.toThrow(/IPC protocol error/);
    } finally { await app.close(); }
  });

  it("reports a failed initial connection so the server can schedule a reconnect", async () => {
    const client = new DesktopIpcClient({
      socketPath: `/tmp/farfield-missing-${randomUUID()}.sock`
    });
    const states: IpcConnectionState[] = [];
    client.onConnectionState((state) => states.push(state));

    await expect(client.connect()).rejects.toThrow(/ENOENT/);

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      connected: false
    });
    expect(states[0]?.reason).toMatch(/ENOENT/);
  });
});
