import { IncomingMessage } from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  getRequestNetworkInfo,
  isLoopbackAddress,
  isLoopbackHost
} from "../src/network.js";

function createRequestWithAddress(address: string | null): IncomingMessage {
  const socket = new net.Socket();
  Object.defineProperty(socket, "remoteAddress", {
    value: address
  });
  return new IncomingMessage(socket);
}

function createRequestWithClientAddress(
  socketAddress: string | null,
  clientAddress: string
): IncomingMessage {
  const request = createRequestWithAddress(socketAddress);
  request.headers["x-farfield-client-address"] = clientAddress;
  return request;
}

describe("network helpers", () => {
  it("detects loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("detects loopback addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.12.4.9")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("100.64.0.2")).toBe(false);
  });

  it("classifies request origin", () => {
    const localReq = createRequestWithAddress("::ffff:127.0.0.1");
    const local = getRequestNetworkInfo(localReq);
    expect(local.isRemote).toBe(false);

    const remoteReq = createRequestWithAddress("100.74.0.9");
    const remote = getRequestNetworkInfo(remoteReq);
    expect(remote.isRemote).toBe(true);
  });

  it("uses the proxy client address only for a loopback proxy peer", () => {
    const proxiedRemote = getRequestNetworkInfo(
      createRequestWithClientAddress("127.0.0.1", "100.74.0.9")
    );
    expect(proxiedRemote.remoteAddress).toBe("100.74.0.9");
    expect(proxiedRemote.isRemote).toBe(true);

    const proxiedLocal = getRequestNetworkInfo(
      createRequestWithClientAddress("127.0.0.1", "127.0.0.1")
    );
    expect(proxiedLocal.remoteAddress).toBe("127.0.0.1");
    expect(proxiedLocal.isRemote).toBe(false);
  });

  it("does not let a remote backend peer spoof a local client address", () => {
    const spoofed = getRequestNetworkInfo(
      createRequestWithClientAddress("100.74.0.9", "127.0.0.1")
    );
    expect(spoofed.remoteAddress).toBe("100.74.0.9");
    expect(spoofed.isRemote).toBe(true);
  });

  it("classifies malformed trusted proxy addresses as remote", () => {
    const malformed = getRequestNetworkInfo(
      createRequestWithClientAddress("127.0.0.1", "127.0.0.1, 100.74.0.9")
    );
    expect(malformed.remoteAddress).toBe(null);
    expect(malformed.isRemote).toBe(true);
  });

  it("preserves the remote boundary behind the production loopback HTTPS proxy", () => {
    const request = createRequestWithClientAddress("127.0.0.1", "127.0.0.1");
    request.headers.host = "fedora.example.ts.net";
    request.headers["x-forwarded-for"] = "100.74.0.9";
    expect(getRequestNetworkInfo(request, { directWeb: true })).toEqual({
      remoteAddress: "100.74.0.9", isRemote: true
    });
    delete request.headers["x-forwarded-for"];
    expect(getRequestNetworkInfo(request, { directWeb: true }).isRemote).toBe(true);
    request.headers["x-forwarded-for"] = "127.0.0.1, 100.74.0.9";
    expect(getRequestNetworkInfo(request, { directWeb: true }).isRemote).toBe(true);
  });

  it("ignores spoofed forwarded headers from direct remote peers", () => {
    const request = createRequestWithAddress("100.74.0.9");
    request.headers["x-forwarded-for"] = "127.0.0.1";
    expect(getRequestNetworkInfo(request, { directWeb: true }).isRemote).toBe(true);
    const local = createRequestWithAddress("::1");
    local.headers.host = "localhost:4312";
    expect(getRequestNetworkInfo(local, { directWeb: true }).isRemote).toBe(false);
  });
});
