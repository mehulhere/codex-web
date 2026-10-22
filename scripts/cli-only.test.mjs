import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const root = fileURLToPath(new URL("../", import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(cliOnly) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-web-cli-test-"));
  let connections = 0;
  const sockets = new Set();
  const ipc = createServer(socket => { connections++; sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  const socket = path.join(directory, "desktop.sock");
  ipc.listen(socket); await once(ipc, "listening");
  const portServer = createServer(); portServer.listen(0, "127.0.0.1"); await once(portServer, "listening");
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const executable = path.join(directory, "codex");
  await writeFile(executable, `#!${process.execPath}\nimport ${JSON.stringify(path.join(root, "scripts/fixtures/cli-only-app-server.mjs"))};\n`, { mode: 0o700 });
  await mkdir(path.join(directory, "home"));
  const env = { ...process.env, HOST: "127.0.0.1", PORT: String(port), FARFIELD_SERVE_WEB: "1",
    FARFIELD_AUTH_PIN: "synthetic-password", FARFIELD_AUTH_COOKIE_SECURE: "0", MULTI_ACCOUNT: "false",
    CODEX_CLI_PATH: executable, CODEX_IPC_SOCKET: socket, CODEX_HOME: path.join(directory, "home"),
    XDG_STATE_HOME: path.join(directory, "state"), CODEX_CLI_ONLY: cliOnly };
  if (cliOnly === undefined) delete env.CODEX_CLI_ONLY;
  const server = spawn(process.execPath, [path.join(root, "apps/server/dist/index.js")], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; server.stdout.on("data", chunk => { output = (output + chunk).slice(-5000); });
  server.stderr.on("data", chunk => { output = (output + chunk).slice(-5000); });
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(`${origin}/api/auth/session`); if (response.ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await delay(50);
  }
  async function close() {
    const exited = once(server, "exit"); server.kill("SIGTERM");
    await Promise.race([exited, delay(2000)]); if (server.exitCode === null) server.kill("SIGKILL");
    for (const active of sockets) active.destroy();
    await new Promise(resolve => ipc.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
  if (!ready) { await close(); throw new Error(`Synthetic server did not start: ${output}`); }
  return { origin, connections: () => connections, logs: () => output, close };
}

test("CLI-only browser sends, resumes, answers requests and manages queues without Desktop", { timeout: 60_000 }, async () => {
  const app = await fixture("true");
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${app.origin}/threads/thread-cli`);
    await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await page.getByLabel("CLI connected", { exact: true }).waitFor();
    await page.getByRole("log", { name: "Conversation" }).getByText("Synthetic history", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Usage and resets", exact: true }).count(), 0);
    const api = async (route, method = "GET", data) => {
      const response = await context.request.fetch(app.origin + route, { method, ...(data ? { data } : {}) });
      assert(response.ok(), `${method} ${route}: ${response.status()} ${await response.text()}`); return response.json();
    };
    const base = "/api/threads/thread-cli";
    const admitted = await api(`${base}/queue`, "POST", { text: "Explicit queued message" });
    await page.getByRole("region", { name: "Queued follow-ups" }).getByText("Explicit queued message", { exact: true }).waitFor();
    await api(`${base}/queue/${admitted.messageId}`, "DELETE");
    await api(`${base}/queue`, "POST", { text: "Start native queue" });
    await page.getByRole("button", { name: "Steer Start native queue", exact: true }).click();
    await page.getByText("Started: Start native queue", { exact: true }).waitFor();
    const send = async text => {
      const composer = page.getByPlaceholder(/^(Message Codex…|Ask for follow-up changes)$/);
      await composer.fill(text);
      try {
        const [response] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === `${base}/messages` && response.request().method() === "POST"),
          page.getByRole("button", { name: /^(Send message|Queue follow-up|Steer follow-up)$/ }).click()
        ]);
        assert(response.ok(), `Message was rejected with HTTP ${response.status()}`);
        await page.waitForFunction(() => [...document.querySelectorAll("textarea")].some(element =>
          /^(Message Codex…|Ask for follow-up changes)$/.test(element.placeholder) && !element.disabled && element.value === ""));
      }
      catch (error) { throw new Error(`Could not send ${text}; draft=${JSON.stringify(await composer.inputValue())}; alerts=${await page.getByRole("alert").allTextContents()}`, { cause: error }); }
    };
    await send("first");
    await page.getByText("Reply: first", { exact: true }).waitFor();
    await page.reload(); await page.getByLabel("CLI connected", { exact: true }).waitFor();
    await send("second"); await page.getByText("Reply: second", { exact: true }).waitFor();
    await send("approval");
    await page.getByRole("button", { name: "Approve once", exact: true }).waitFor();
    assert.equal((await api(`${base}/live-state`)).cliRequests.length, 1);
    await page.reload();
    await page.getByRole("button", { name: "Approve once", exact: true }).click();
    await page.getByText('{"decision":"accept"}', { exact: true }).waitFor();
    await send("file-approval");
    await page.getByRole("heading", { name: "Approve file changes?" }).waitFor();
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await page.getByText('{"decision":"decline"}', { exact: true }).waitFor();
    await send("questions");
    await page.getByRole("combobox", { name: "Which color?", exact: true }).selectOption("Blue");
    await page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await page.getByText('{"answers":{"choice":{"answers":["Blue"]}}}', { exact: true }).waitFor();
    await send("hold");
    assert.equal((await context.request.post(`${app.origin}${base}/queue`, { data: { text: "Do not release a running chat" } })).status(), 409);
    await send("queued example");
    const queue = page.getByRole("region", { name: "Queued follow-ups" });
    await queue.getByText("queued example", { exact: true }).waitFor();
    await page.reload(); await queue.getByText("queued example", { exact: true }).waitFor();
    await queue.getByRole("button", { name: "Edit queued example", exact: true }).click();
    await queue.getByLabel("Edit queued message", { exact: true }).fill("edited queued example");
    await queue.getByRole("button", { name: "Save queued message", exact: true }).click();
    await queue.getByText("edited queued example", { exact: true }).waitFor();
    await queue.getByRole("button", { name: "Delete edited queued example", exact: true }).click();
    await queue.getByText("edited queued example", { exact: true }).waitFor({ state: "hidden" });
    await send("steer queued example");
    await queue.getByRole("button", { name: "Steer steer queued example", exact: true }).click();
    await page.getByText("Steered: steer queued example", { exact: true }).waitFor();
    await send("hold");
    await api(`${base}/interrupt`, "POST", {});
    await api(`${base}/settings`, "PATCH", { model: "model-test", effort: "high" });
    const health = await api("/api/health");
    assert.equal(health.state.cliOnly, true); assert.equal(health.state.ipcConnected, false);
    assert.equal(health.state.ipcInitialized, false); assert.equal(app.connections(), 0);
    assert.equal((await context.request.get(`${app.origin}/api/accounts/resets?threadId=thread-cli`)).status(), 501);
    assert.deepEqual(errors, []);
  } catch (error) {
    throw new Error(`CLI browser check: ${error.message}\nSynthetic server diagnostics: ${app.logs()}`, { cause: error });
  } finally { await browser?.close(); await app.close(); }
});

test("CLI-only new chat supports settings, reload and first send before any rollout exists", { timeout: 30_000 }, async () => {
  const app = await fixture("true");
  let browser;
  let page;
  const observed = [];
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage(); page.setDefaultTimeout(10_000);
    const failures = [];
    page.on("response", response => {
      if (!response.url().startsWith(app.origin + "/api/") && response.url() !== app.origin + "/events") return;
      const entry = `${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`;
      observed.push(entry);
      if (response.status() >= 400) failures.push(entry);
    });
    page.on("pageerror", error => failures.push(error.message));
    await page.goto(`${app.origin}/threads/thread-cli`);
    await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
    const [login] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST"),
      page.getByRole("button", { name: "Unlock", exact: true }).click()
    ]);
    assert(login.ok(), `Login rejected: ${login.status()}`);
    await page.getByRole("form", { name: "Unlock Codex Mobile" }).waitFor({ state: "hidden" });
    await page.getByLabel("CLI connected", { exact: true }).waitFor();
    const [created] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/threads" && response.request().method() === "POST"),
      page.getByRole("button", { name: /New thread in/ }).click()
    ]);
    assert(created.ok());
    const { threadId } = await created.json();
    const base = `/api/threads/${threadId}`;
    const live = await context.request.get(app.origin + base + "/live-state");
    assert(live.ok(), `New chat live state: ${live.status()} ${await live.text()}`);
    assert.deepEqual((await live.json()).conversationState.turns, []);
    const patch = await context.request.patch(app.origin + base + "/settings", { data: { model: "model-test", effort: "low" } });
    assert(patch.ok(), `New chat settings: ${patch.status()} ${await patch.text()}`);
    const settings = await (await context.request.get(app.origin + base + "/settings")).json();
    assert.equal(settings.reasoningEffort, "low");
    const mode = await context.request.post(app.origin + base + "/collaboration-mode", { data: { collaborationMode: { mode: "default", settings: { model: "model-test", reasoning_effort: "high", developer_instructions: null } } } });
    assert(mode.ok(), `New chat mode: ${mode.status()} ${await mode.text()}`);
    await page.reload();
    await page.getByText("No messages yet", { exact: true }).waitFor();
    const composer = page.getByPlaceholder("Message Codex…", { exact: true });
    await composer.fill("new chat first message");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("Reply: new chat first message", { exact: true }).waitFor();
    assert.deepEqual(failures, []);
    assert.equal(app.connections(), 0);
  } catch (error) {
    const screen = page && !page.isClosed() ? await page.locator("body").innerText().catch(() => "Unavailable") : "Unavailable";
    throw new Error(`New chat check: ${error.message}\nObserved synthetic requests: ${JSON.stringify(observed)}\nSynthetic screen: ${screen}\nSynthetic server diagnostics: ${app.logs()}`, { cause: error });
  } finally { await browser?.close(); await app.close(); }
});

for (const setting of [undefined, "false"]) test(`Desktop mode still requires IPC with CODEX_CLI_ONLY=${setting ?? "unset"}`, { timeout: 15_000 }, async () => {
  const app = await fixture(setting);
  try {
    for (let attempt = 0; attempt < 20 && app.connections() === 0; attempt++) await delay(50);
    assert(app.connections() > 0, "Default/Desktop mode must still attempt its IPC connection");
    const login = await fetch(`${app.origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: "synthetic-password" }) });
    assert(login.ok); const cookie = login.headers.get("set-cookie").split(";")[0];
    const response = await fetch(`${app.origin}/api/threads/thread-cli/messages`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "keep Desktop routing" }) });
    assert.equal(response.status, 503, "An existing Desktop chat must not silently use CLI routing");
    const health = await (await fetch(`${app.origin}/api/health`, { headers: { cookie } })).json();
    assert.equal(health.state.cliOnly, false);
  } finally { await app.close(); }
});
