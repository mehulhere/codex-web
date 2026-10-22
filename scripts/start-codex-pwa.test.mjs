import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./start-codex-pwa.sh", import.meta.url));

async function runGate(smokeExit, args = [], queueExit = 0) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pwa-start-gate-"));
  const bin = path.join(directory, "bin");
  const config = path.join(directory, "config");
  const actions = path.join(directory, "actions");
  await mkdir(bin);
  await mkdir(path.join(config, "codex-mobile"), { recursive: true });
  await writeFile(path.join(config, "codex-mobile/environment"), "FARFIELD_AUTH_PIN=test-pin\n");
  await writeFile(actions, "");
  for (const [name, body] of Object.entries({
    systemctl: 'printf "service:%s\\n" "$*" >> "$GATE_ACTIONS"',
    curl: 'printf "listener\\n" >> "$GATE_ACTIONS"',
    node: 'printf "browser:%s\\n" "$*" >> "$GATE_ACTIONS"; case "$1" in *pwa-queue-test.mjs) exit "$GATE_QUEUE_EXIT" ;; *) exit "$GATE_SMOKE_EXIT" ;; esac'
  })) {
    const filename = path.join(bin, name);
    await writeFile(filename, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    await chmod(filename, 0o700);
  }
  try {
    const result = await new Promise(resolve => execFile("bash", [script, ...args], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_CONFIG_HOME: config,
        XDG_STATE_HOME: path.join(directory, "state"), GATE_ACTIONS: actions, GATE_SMOKE_EXIT: String(smokeExit), GATE_QUEUE_EXIT: String(queueExit) }
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
    return { ...result, actions: await readFile(actions, "utf8") };
  } finally { await rm(directory, { recursive: true }); }
}

test("start command reports ready only after a successful browser gate", async () => {
  const result = await runGate(0);
  assert.equal(result.code, 0);
  assert.match(result.actions, /service:--user start codex-mobile.service\nlistener\nbrowser:/);
  assert.match(result.stdout, /is READY/);
  assert.equal(result.stdout.includes("test-pin"), false);
});
test("an active service cannot mask a failed browser check", async () => {
  const result = await runGate(1, ["--restart"]);
  assert.equal(result.code, 1);
  assert.match(result.actions, /--user restart codex-mobile.service/);
  assert.match(result.stderr, /NOT READY/);
  assert.doesNotMatch(result.stdout, /is READY/);
});
test("startup readiness cannot be weakened to read-only checks", async () => {
  const result = await runGate(0, ["--read-only"]);
  assert.equal(result.code, 2);
  assert.equal(result.actions, "");
});

test("a passing send test cannot mask a failed real queue check", async () => {
  const result = await runGate(0, [], 1);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /NOT READY/);
  assert.doesNotMatch(result.stdout, /is READY/);
});
