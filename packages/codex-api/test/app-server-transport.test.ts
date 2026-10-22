import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ChildProcessAppServerTransport,
  AppServerServerRequestError
} from "../src/app-server-transport.js";

async function withFakeAppServer(
  run: (executablePath: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "farfield-app-server-test-"));
  const executablePath = path.join(directory, "fake-app-server");
  await writeFile(executablePath, `#!${process.execPath}
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
let probeId;
input.on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
  } else if (message.method === "probe") {
    probeId = message.id;
    process.stdout.write(JSON.stringify({
      id: "request-1", method: "item/tool/requestUserInput",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", questions: [] }
    }) + "\\n");
  } else if (message.id === "request-1") {
    process.stdout.write(JSON.stringify({ id: probeId, result: message }) + "\\n");
  }
});
`);
  await chmod(executablePath, 0o700);
  try {
    await run(executablePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("ChildProcessAppServerTransport server requests", () => {
  it("returns the handler result to the matching string request id", async () => {
    await withFakeAppServer(async executablePath => {
      const handler = vi.fn(async () => ({ answers: { question_1: { answers: ["first"] } } }));
      const transport = new ChildProcessAppServerTransport({
        executablePath,
        userAgent: "farfield-test",
        onServerRequest: handler
      });
      try {
        const reply = await transport.request("probe", {});
        expect(handler).toHaveBeenCalledWith({
          id: "request-1",
          method: "item/tool/requestUserInput",
          params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", questions: [] }
        });
        expect(reply).toEqual({
          id: "request-1",
          result: { answers: { question_1: { answers: ["first"] } } }
        });
      } finally {
        await transport.close();
      }
    });
  });

  it("sends explicit JSON-RPC errors for rejected requests", async () => {
    await withFakeAppServer(async executablePath => {
      const transport = new ChildProcessAppServerTransport({
        executablePath,
        userAgent: "farfield-test",
        onServerRequest: () => {
          throw new AppServerServerRequestError(-32601, "Unsupported request");
        }
      });
      try {
        await expect(transport.request("probe", {})).resolves.toMatchObject({
          id: "request-1",
          error: { code: -32601, message: "Unsupported request" }
        });
      } finally {
        await transport.close();
      }
    });
  });

  it("rejects unsupported server requests when no handler was configured", async () => {
    await withFakeAppServer(async executablePath => {
      const transport = new ChildProcessAppServerTransport({ executablePath, userAgent: "farfield-test" });
      try {
        await expect(transport.request("probe", {})).resolves.toMatchObject({
          id: "request-1",
          error: { code: -32601 }
        });
      } finally {
        await transport.close();
      }
    });
  });

  it("returns an internal error when an asynchronous handler rejects", async () => {
    await withFakeAppServer(async executablePath => {
      const transport = new ChildProcessAppServerTransport({
        executablePath,
        userAgent: "farfield-test",
        onServerRequest: async () => { throw new Error("Handler failed"); }
      });
      try {
        await expect(transport.request("probe", {})).resolves.toMatchObject({
          id: "request-1",
          error: { code: -32603, message: "Handler failed" }
        });
      } finally {
        await transport.close();
      }
    });
  });

  it("reports closure and ignores a late answer from the old child", async () => {
    await withFakeAppServer(async executablePath => {
      let finishRequest: ((value: unknown) => void) | undefined;
      const closed = vi.fn();
      const transport = new ChildProcessAppServerTransport({
        executablePath,
        userAgent: "farfield-test",
        onServerRequest: () => new Promise(resolve => { finishRequest = resolve; }),
        onTransportClosed: closed
      });
      const pending = transport.request("probe", {});
      await vi.waitFor(() => expect(finishRequest).toBeTypeOf("function"));
      await transport.close();
      finishRequest?.({ answers: {} });
      await expect(pending).rejects.toThrow("app-server transport closed");
      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    });
  });
});
