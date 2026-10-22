import { IncomingMessage } from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { resolveProxyClientAddress } from "../src/proxy-network.js";

function createRequest(
  address: string,
  forwardedFor?: string,
  host = "127.0.0.1:4312"
): IncomingMessage {
  const socket = new net.Socket();
  Object.defineProperty(socket, "remoteAddress", {
    value: address
  });
  const request = new IncomingMessage(socket);
  request.headers.host = host;
  if (forwardedFor) {
    request.headers["x-forwarded-for"] = forwardedFor;
  }
  return request;
}

describe("proxy client address", () => {
  it("uses a direct remote browser address", () => {
    expect(resolveProxyClientAddress(createRequest("100.74.0.9"))).toBe("100.74.0.9");
  });

  it("keeps a direct local browser local", () => {
    expect(resolveProxyClientAddress(createRequest("127.0.0.1"))).toBe("127.0.0.1");
  });

  it("uses a valid forwarded client from a loopback reverse proxy", () => {
    expect(resolveProxyClientAddress(createRequest("127.0.0.1", "100.74.0.9"))).toBe(
      "100.74.0.9"
    );
  });

  it("uses a restrictive address for malformed forwarding data", () => {
    expect(
      resolveProxyClientAddress(createRequest("127.0.0.1", "100.74.0.9, 127.0.0.1"))
    ).toBe("0.0.0.0");
  });

  it("treats a non-local reverse-proxy host without forwarding data as remote", () => {
    expect(
      resolveProxyClientAddress(
        createRequest("127.0.0.1", undefined, "desktop.example.ts.net")
      )
    ).toBe("0.0.0.0");
  });
});
