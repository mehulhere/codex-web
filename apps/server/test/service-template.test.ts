import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Codex Mobile user service", () => {
  it("runs the prebuilt PWA and authenticated API in one server", () => {
    const service = readFileSync(
      resolve(process.cwd(), "../../systemd/codex-mobile.service"),
      "utf8"
    );

    expect(service).toContain("EnvironmentFile=%h/.config/codex-mobile/environment");
    expect(service).toContain("Environment=PATH=__TOOL_PATH__");
    expect(service).not.toContain("Environment=FARFIELD_AUTH_COOKIE_SECURE=1");
    expect(service).toContain(
      'ExecStart="__NODE_PATH__" "__PROJECT_DIR__/apps/server/dist/index.js"'
    );
    expect(service).not.toContain("ExecStart=__PNPM_PATH__ start:remote");
    expect(service).toContain("Environment=PORT=4312");
    expect(service).toContain("Environment=FARFIELD_SERVE_WEB=1");
    expect(service).not.toContain("vite");
    expect(service).toContain("Restart=on-failure");
    expect(service).toContain("WorkingDirectory=__PROJECT_DIR__");
  });

  it("provides reversible install and uninstall commands", () => {
    const installer = readFileSync(
      resolve(process.cwd(), "../../scripts/install-user-service.sh"),
      "utf8"
    );

    expect(installer).toContain('case "${1:-install}" in');
    expect(installer).toContain('pnpm_path="$(command -v pnpm)"');
    expect(installer).toContain('tool_path="$(dirname "$pnpm_path")');
    expect(installer).toContain('s|__NODE_PATH__|$node_path|g');
    expect(installer).toContain('s|__TOOL_PATH__|$tool_path|g');
    expect(installer).toContain('"$pnpm_path" build');
    expect(installer).toContain("systemctl --user enable codex-mobile.service");
    expect(installer).toContain("systemctl --user restart codex-mobile.service");
    expect(installer).toContain("systemctl --user disable --now codex-mobile.service");
    expect(installer).toContain("FARFIELD_AUTH_COOKIE_SECURE=1");
  });

  it("gives the persistent watchdog the auth environment and tool path it needs", () => {
    const service = readFileSync(
      resolve(process.cwd(), "../../systemd/codex-mobile-watchdog.service"),
      "utf8"
    );

    expect(service).toContain("EnvironmentFile=%h/.config/codex-mobile/environment");
    expect(service).toContain("Environment=PATH=__TOOL_PATH__");
  });

  it("starts both production processes with the same recursive script name", () => {
    const rootPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), "../../package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    const webPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), "../web/package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["start:remote"]).toContain(
      "--filter @farfield/server --filter @farfield/web start:remote"
    );
    expect(webPackage.scripts["start:remote"]).toBe(
      "vite preview --host 0.0.0.0 --port 4312"
    );
  });
});
