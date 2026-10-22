import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./codex-mobile-watchdog.sh", import.meta.url));

function runWatchdog(environment) {
  return new Promise((resolve, reject) => {
    execFile(
      scriptPath,
      {
        env: {
          ...process.env,
          CODEX_MOBILE_WATCHDOG_RETRIES: "1",
          CODEX_MOBILE_WATCHDOG_RETRY_DELAY_SECONDS: "0",
          ...environment
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function createFixture({ active = true, curlMode = "healthy" } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-mobile-watchdog-"));
  const statePath = path.join(directory, "state");
  const actionPath = path.join(directory, "actions");
  const systemctlPath = path.join(directory, "systemctl");
  const curlPath = path.join(directory, "curl");
  await writeFile(statePath, active ? "active" : "inactive");
  await writeFile(actionPath, "");
  await writeFile(
    systemctlPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"is-active"* ]]; then
  [[ "$(cat "$WATCHDOG_STATE")" == "active" ]]
  exit
fi
if [[ "$*" == *"restart"* ]]; then
  printf 'restart\\n' >> "$WATCHDOG_ACTIONS"
  printf 'active' > "$WATCHDOG_STATE"
  exit
fi
exit 2
`
  );
  await writeFile(
    curlPath,
    `#!/usr/bin/env bash
set -euo pipefail
url="\${!#}"
mode="$WATCHDOG_CURL_MODE"
if [[ -s "$WATCHDOG_ACTIONS" ]]; then mode="healthy"; fi
output_path="/dev/null"
headers_path=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--output" ]]; then output_path="$argument"; fi
  if [[ "$previous" == "--dump-header" ]]; then headers_path="$argument"; fi
  previous="$argument"
done
if [[ -n "$headers_path" ]]; then
  printf 'HTTP/1.1 200 OK\\r\\nSet-Cookie: farfield_session=test-session; Path=/; HttpOnly; Secure\\r\\n\\r\\n' > "$headers_path"
fi
if [[ "$url" == *"/api/threads?limit=1" && "$output_path" != "/dev/null" ]]; then
  printf '{"ok":true,"data":[{"id":"thread-1"}]}' > "$output_path"
fi
if [[ "$mode" == "backend-failure" && "$url" == *"/api/health" ]]; then
  printf '503'
elif [[ "$mode" == "pwa-failure" && "$url" == *":4312/" ]]; then
  printf '503'
elif [[ "$mode" == "chat-failure" && "$url" == *"/api/threads/thread-1"* ]]; then
  printf '500'
elif [[ "$url" == *"/api/health" ]]; then
  printf '401'
else
  printf '200'
fi
`
  );
  await chmod(systemctlPath, 0o755);
  await chmod(curlPath, 0o755);
  return {
    directory,
    actionPath,
    environment: {
      CODEX_MOBILE_WATCHDOG_SYSTEMCTL: systemctlPath,
      CODEX_MOBILE_WATCHDOG_CURL: curlPath,
      WATCHDOG_STATE: statePath,
      WATCHDOG_ACTIONS: actionPath,
      WATCHDOG_CURL_MODE: curlMode,
      FARFIELD_AUTH_PIN: "12345678"
    }
  };
}

test("leaves a healthy service running without restarting it", async () => {
  const fixture = await createFixture();
  try {
    const result = await runWatchdog(fixture.environment);
    assert.match(result.stdout, /status=healthy components=all action=none/);
    assert.equal(await readFile(fixture.actionPath, "utf8"), "");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("reports upstream degradation without restarting a healthy PWA", async () => {
  const fixture = await createFixture({ curlMode: "chat-failure" });
  try {
    const result = await runWatchdog({
      ...fixture.environment,
      FARFIELD_AUTH_PIN: "12345678"
    });
    assert.match(
      result.stdout,
      /status=degraded component=desktop-chat action=none/
    );
    assert.equal(await readFile(fixture.actionPath, "utf8"), "");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("restarts a stopped service and verifies recovery", async () => {
  const fixture = await createFixture({ active: false });
  try {
    const result = await runWatchdog(fixture.environment);
    assert.match(result.stdout, /status=recovered components=all action=none/);
    assert.match(result.stdout, /status=unhealthy components=service action=restart/);
    assert.equal(await readFile(fixture.actionPath, "utf8"), "restart\n");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("restarts an active service when the PWA endpoint is unhealthy", async () => {
  const fixture = await createFixture({ curlMode: "pwa-failure" });
  try {
    const result = await runWatchdog(fixture.environment);
    assert.match(result.stdout, /status=recovered components=all action=none/);
    assert.match(result.stdout, /status=unhealthy components=pwa action=restart/);
    assert.equal(await readFile(fixture.actionPath, "utf8"), "restart\n");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("restarts an active service when the backend endpoint is unhealthy", async () => {
  const fixture = await createFixture({ curlMode: "backend-failure" });
  try {
    const result = await runWatchdog(fixture.environment);
    assert.match(result.stdout, /status=recovered components=all action=none/);
    assert.match(result.stdout, /status=unhealthy components=backend action=restart/);
    assert.equal(await readFile(fixture.actionPath, "utf8"), "restart\n");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
