import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

import { getRemoteStatusSnapshot } from "../src/remote-status.js";

const execFileSyncMock = vi.mocked(execFileSync);

describe("getRemoteStatusSnapshot", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("returns tailscale IPv4 addresses when available", () => {
    execFileSyncMock.mockReturnValue("100.64.0.2\n100.72.0.7\n");

    const snapshot = getRemoteStatusSnapshot("0.0.0.0", 4311);
    expect(snapshot.tailscaleInstalled).toBe(true);
    expect(snapshot.tailscaleIps).toEqual(["100.64.0.2", "100.72.0.7"]);
    expect(snapshot.host).toBe("0.0.0.0");
  });

  it("marks tailscale as missing when command is unavailable", () => {
    const missingCommandError = Object.assign(new Error("missing"), {
      code: "ENOENT"
    });
    execFileSyncMock.mockImplementation(() => {
      throw missingCommandError;
    });

    const snapshot = getRemoteStatusSnapshot("0.0.0.0", 4311);
    expect(snapshot.tailscaleInstalled).toBe(false);
    expect(snapshot.tailscaleIps).toEqual([]);
  });

  it("returns installed true with empty IP list when command errors", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("tailscale daemon unavailable");
    });

    const snapshot = getRemoteStatusSnapshot("0.0.0.0", 4311);
    expect(snapshot.tailscaleInstalled).toBe(true);
    expect(snapshot.tailscaleIps).toEqual([]);
  });
});
