import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

describe("system stability guard", () => {
  it("keeps remote activity from reloading Desktop windows", () => {
    const server = readFileSync(resolve(repoRoot, "apps/server/src/index.ts"), "utf8");
    const service = readFileSync(
      resolve(repoRoot, "packages/codex-api/src/service.ts"),
      "utf8"
    );

    expect(server).not.toContain("refreshDesktopThread");
    expect(service).not.toContain("thread-follower-refresh-conversation");
    expect(
      existsSync(resolve(repoRoot, "apps/server/src/desktop-thread-rehydrator.ts"))
    ).toBe(false);
  });

  it("releases app-server task ownership when a turn completes", () => {
    const server = readFileSync(resolve(repoRoot, "apps/server/src/index.ts"), "utf8");

    expect(server).toContain("appClient.onTurnCompleted");
    expect(server).toContain("appClient.unsubscribeThread");
    expect(server).toMatch(/appServerFollowUpQueue\s*\.releaseIfIdle/);
  });

  it("keeps service recovery on prebuilt artifacts", () => {
    const service = readFileSync(
      resolve(repoRoot, "systemd/codex-mobile.service"),
      "utf8"
    );

    expect(service).not.toContain("ExecStart=__PNPM_PATH__ start:remote");
    expect(service).toContain("/apps/server/dist/index.js");
    expect(service).not.toContain("pnpm");
  });
});
