import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { HealthResponseSchema, ThreadSettingsResponseSchema } from "../apps/server/dist/http-schemas.js";

const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const { z } = require("zod");
const { AppServerReadThreadResponseSchema, AppServerStartThreadResponseSchema } = require("@farfield/protocol");

const OptionsSchema = z.object({
  origin: z.string().url().refine(value => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" &&
      (url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  }, "Use an HTTPS origin, or a loopback HTTP origin for local tests").transform(value => new URL(value).origin),
  pin: z.string().min(1).max(128),
  outputDirectory: z.string().min(1),
  timeoutMs: z.number().int().positive().default(30_000),
  replyTimeoutMs: z.number().int().positive().default(120_000),
  send: z.boolean().default(false),
  model: z.string().min(1).default("gpt-6.1-sol"),
  headed: z.boolean().default(false),
  progress: z.function().args(z.string()).returns(z.void()).optional()
}).strict();
const TestThreadSchema = z.object({
  origin: z.string().url(), threadId: z.string().min(1), cwd: z.string().min(1)
}).strict();
const CreatedThreadSchema = AppServerStartThreadResponseSchema.extend({
  ok: z.literal(true), threadId: z.string().min(1)
}).strict();
const HistoryResponseSchema = AppServerReadThreadResponseSchema.extend({ ok: z.literal(true) }).strict();

function errorMessage(error, pin) {
  return z.instanceof(Error).parse(error).message.replaceAll(pin, "[redacted]").slice(0, 1_000);
}

export async function runPwaSmokeTest(input) {
  const options = OptionsSchema.parse(input);
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(options.outputDirectory, "run-"));
  const screenshot = path.join(directory, "browser.png");
  const reportPath = path.join(directory, "report.json");
  const checks = [];
  const errors = new Set();
  const observed = new Map();
  const startedAt = new Date().toISOString();
  let browser;
  let context;
  let page;
  let threadId = null;
  const addError = message => { if (errors.size < 20) errors.add(message.replaceAll(options.pin, "[redacted]")); };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  try {
    options.progress?.("Opening a fresh mobile browser and checking password login");
    browser = await chromium.launch({ channel: "chrome", headless: !options.headed });
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    page.on("pageerror", error => addError(`Browser runtime: ${errorMessage(error, options.pin)}`));
    page.on("console", message => { if (message.type() === "error") addError(`Browser console: ${message.text().slice(0, 300)}`); });
    page.on("requestfailed", request => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") {
        addError(`Network failure: ${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin !== options.origin) return;
      if (response.status() >= 400) addError(`HTTP ${response.status()}: ${response.request().method()} ${url.pathname}`);
      if (response.request().method() !== "GET") return;
      if (url.pathname === "/api/health") observed.set("health", response);
      if (url.pathname === "/api/models") observed.set("models", response);
      if (url.pathname === "/events") observed.set("events", response);
      if (/^\/api\/threads\/[^/]+$/.test(url.pathname) && url.searchParams.get("includeTurns") === "true" &&
          (threadId === null || url.pathname === `/api/threads/${encodeURIComponent(threadId)}`)) observed.set("history", response);
      if (/^\/api\/threads\/[^/]+\/settings$/.test(url.pathname) &&
          (threadId === null || url.pathname === `/api/threads/${encodeURIComponent(threadId)}/settings`)) observed.set("settings", response);
    });
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const writes = !["GET", "HEAD", "OPTIONS"].includes(request.method());
      const allowedAuth = url.origin === options.origin && ["/api/auth/login", "/api/auth/logout", "/api/client-errors"].includes(url.pathname);
      const allowedMessage = options.send && threadId !== null && url.origin === options.origin &&
        url.pathname === `/api/threads/${encodeURIComponent(threadId)}/messages` && request.method() === "POST";
      if ((writes && !allowedAuth && !allowedMessage) ||
          (request.isNavigationRequest() && url.origin !== options.origin)) {
        addError(`Blocked unexpected action: ${request.method()} ${url.pathname}`);
        await route.abort();
      } else await route.continue();
    });

    const protectedResponse = await context.request.get(`${options.origin}/api/threads?limit=1`);
    assert(protectedResponse.status() === 401, "Chat API was accessible without a password session");
    checks.push("unauthenticated-access-blocked");
    await page.goto(options.origin, { waitUntil: "domcontentloaded" });
    const loginForm = page.getByRole("form", { name: "Unlock Codex Mobile" });
    const password = loginForm.getByLabel("Password", { exact: true });
    await password.waitFor({ state: "visible" });
    assert(new URL(page.url()).origin === options.origin, "Login redirected to a different origin");
    assert(await password.getAttribute("type") === "password", "Login must use a password input");
    assert(await password.getAttribute("name") === "password", "Password needs a stable field name");
    assert(await password.getAttribute("autocomplete") === "current-password", "Saved-password autofill is missing");
    assert(await loginForm.locator('input[name="username"][autocomplete="username"]').inputValue() === "codex-mobile",
      "Password manager account identity is missing");
    checks.push("password-manager-form");
    await password.fill(options.pin);
    const loginResult = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login");
    await password.press("Enter");
    assert((await loginResult).ok(), "Password login failed");
    await page.getByPlaceholder(/^(Message Codex…|Ask for follow-up changes)$/).waitFor({ state: "visible" });
    checks.push("browser-password-login");

    async function waitObserved(key) {
      const deadline = Date.now() + options.timeoutMs;
      while (!observed.has(key)) {
        assert(Date.now() < deadline, `Browser did not load ${key}`);
        assert(errors.size === 0, [...errors].join("; "));
        await delay(25);
      }
      const response = observed.get(key);
      assert(response.ok(), `Browser ${key} request returned HTTP ${response.status()}`);
      return response;
    }

    async function verifyUi() {
      const health = HealthResponseSchema.parse(await (await waitObserved("health")).json());
      assert(health.state.appReady && health.state.ipcConnected && health.state.ipcInitialized,
        "Codex app-server or Desktop IPC is not ready");
      const history = HistoryResponseSchema.parse(await (await waitObserved("history")).json());
      const settings = ThreadSettingsResponseSchema.parse(await (await waitObserved("settings")).json());
      await waitObserved("models");
      await waitObserved("events");
      await page.getByLabel("Desktop connected", { exact: true }).waitFor({ state: "visible" });
      await page.waitForURL(`${options.origin}/threads/${encodeURIComponent(history.thread.id)}`);
      const conversation = page.getByRole("log", { name: "Conversation" });
      await conversation.waitFor({ state: "visible" });
      assert((await conversation.innerText()).trim().length > 0, "Conversation did not render");
      assert(await conversation.evaluate(element =>
        element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().width <= window.innerWidth + 1),
        "Conversation overflows horizontally on mobile");
      await page.getByRole("combobox", { name: "Model", exact: true })
        .filter({ hasText: settings.model }).waitFor({ state: "visible" });
      assert(await page.getByPlaceholder(/^(Message Codex…|Ask for follow-up changes)$/).isEnabled(), "Composer is disabled");
      assert(await page.getByRole("alert").count() === 0, "PWA displays an error banner");
      assert(errors.size === 0, [...errors].join("; "));
      return history;
    }

    async function waitForReply(id, token) {
      const deadline = Date.now() + options.replyTimeoutMs;
      while (Date.now() < deadline) {
        const response = await context.request.get(`${options.origin}/api/threads/${encodeURIComponent(id)}?includeTurns=true`);
        assert(response.ok(), `Reply history returned HTTP ${response.status()}`);
        const history = HistoryResponseSchema.parse(await response.json());
        if (history.thread.turns.some(turn => turn.status === "completed" &&
            turn.items.some(item => item.type === "agentMessage" && item.text.trim() === token))) return;
        assert(errors.size === 0, [...errors].join("; "));
        await delay(250);
      }
      throw new Error("Timed out waiting for the exact assistant reply in durable chat history");
    }

    function prompt(token) {
      return `PWA smoke test. Do not use tools, access files, or change anything. Reply with exactly this token and nothing else: ${token}`;
    }

    if (options.send) {
      options.progress?.("Preparing the isolated test chat");
      const stateFile = path.join(options.outputDirectory, "test-thread.json");
      const workspace = path.resolve(options.outputDirectory, "workspace");
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      const saved = await readFile(stateFile, "utf8").catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (saved !== null) {
        const state = TestThreadSchema.parse(JSON.parse(saved));
        assert(state.origin === options.origin && state.cwd === workspace, "Test chat registry does not match this PWA and workspace");
        threadId = state.threadId;
        const response = await context.request.get(`${options.origin}/api/threads/${encodeURIComponent(threadId)}?includeTurns=true`);
        assert(response.ok(), "Dedicated test chat is unavailable; inspect its saved registry before retrying");
        const history = HistoryResponseSchema.parse(await response.json());
        assert(history.thread.cwd === workspace, "Refusing to send into a chat outside the dedicated test workspace");
      } else {
        const response = await context.request.post(`${options.origin}/api/threads`, {
          data: { cwd: workspace, model: options.model, approvalPolicy: "never", sandbox: "read-only" }
        });
        assert(response.ok(), `Test chat creation returned HTTP ${response.status()}`);
        const created = CreatedThreadSchema.parse(await response.json());
        assert(created.thread.cwd === workspace, "Test chat was created in an unexpected workspace");
        threadId = created.threadId;
        const token = `PWA_SMOKE_SETUP_${randomUUID().replaceAll("-", "")}`;
        const seed = await context.request.post(`${options.origin}/api/threads/${encodeURIComponent(threadId)}/messages`, {
          data: { text: prompt(token), cwd: workspace }
        });
        assert(seed.ok(), `Test chat setup message returned HTTP ${seed.status()}`);
        await waitForReply(threadId, token);
        await writeFile(stateFile, JSON.stringify({ origin: options.origin, threadId, cwd: workspace }, null, 2), { mode: 0o600 });
      }
      observed.clear();
      await page.goto(`${options.origin}/threads/${encodeURIComponent(threadId)}`, { waitUntil: "domcontentloaded" });
    }

    await verifyUi();
    checks.push("healthy-desktop-and-app-server", "rendered-history", "mobile-conversation-width", "live-event-stream", "model-picker");
    await page.getByRole("button", { name: "Open tasks", exact: true }).click();
    await page.locator("aside:visible").waitFor({ state: "visible" });
    assert(await page.locator("aside:visible button").count() > 1, "Task sidebar is empty");
    await page.getByRole("button", { name: "Close tasks", exact: true }).click();
    checks.push("task-sidebar");

    const composer = page.getByPlaceholder(/^(Message Codex…|Ask for follow-up changes)$/);
    const send = page.getByRole("button", { name: /^(Send message|Queue follow-up|Steer follow-up)$/ });
    await composer.fill("PWA smoke control check");
    assert(await send.isEnabled(), "Send control is disabled after entering a message");
    await composer.fill("");
    checks.push("composer-controls");

    async function sendAndVerify() {
      const token = `PWA_SMOKE_${randomUUID().replaceAll("-", "")}`;
      await composer.fill(prompt(token));
      const responsePromise = page.waitForResponse(response => response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/threads/${encodeURIComponent(threadId)}/messages`);
      await send.click();
      const response = await responsePromise;
      assert(response.ok(), `Browser message submission returned HTTP ${response.status()}`);
      await waitForReply(threadId, token);
      await page.getByRole("log", { name: "Conversation" }).getByText(token, { exact: true })
        .waitFor({ state: "visible", timeout: options.replyTimeoutMs });
      assert(errors.size === 0, [...errors].join("; "));
    }

    if (options.send) {
      options.progress?.("Sending a browser prompt and waiting for the assistant reply");
      await sendAndVerify();
      checks.push("browser-send-and-assistant-reply");
    }
    observed.clear();
    await page.reload({ waitUntil: "domcontentloaded" });
    await verifyUi();
    assert(await page.getByLabel("Password", { exact: true }).count() === 0, "Session was lost on reload");
    checks.push("session-reload");
    if (options.send) {
      options.progress?.("Sending a follow-up after reload to verify resume");
      await sendAndVerify();
      checks.push("resumed-browser-send-and-assistant-reply");
    }
  } catch (error) {
    addError(errorMessage(error, options.pin));
  } finally {
    if (page) {
      try { await page.screenshot({ path: screenshot, mask: [page.locator('input[type="password"]')] }); }
      catch (error) { addError(`Screenshot failed: ${errorMessage(error, options.pin)}`); }
      await page.close();
    }
    if (context) {
      try { await context.request.post(`${options.origin}/api/auth/logout`); }
      catch (error) { addError(`Logout failed: ${errorMessage(error, options.pin)}`); }
    }
    if (browser) await browser.close();
  }
  const report = {
    ok: errors.size === 0, mode: options.send ? "send-and-resume" : "read-only",
    origin: options.origin, threadId, checks, errors: [...errors],
    startedAt, finishedAt: new Date().toISOString(), screenshot, report: reportPath
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    const { values } = parseArgs({ options: {
      url: { type: "string" }, output: { type: "string" }, timeout: { type: "string" },
      "reply-timeout": { type: "string" }, "read-only": { type: "boolean" }, headed: { type: "boolean" }
    } });
    const origin = values.url ?? process.env["CODEX_MOBILE_PWA_URL"] ??
      execFileSync("tailscale", ["serve", "status"], { encoding: "utf8" }).match(/^https:\/\/\S+/m)?.[0];
    const report = await runPwaSmokeTest({
      origin, pin: process.env["FARFIELD_AUTH_PIN"],
      outputDirectory: values.output ?? path.join(process.env["XDG_STATE_HOME"] ?? path.join(os.homedir(), ".local/state"), "codex-mobile/browser-smoke"),
      timeoutMs: Number(values.timeout ?? 30_000), replyTimeoutMs: Number(values["reply-timeout"] ?? 120_000),
      send: !values["read-only"], headed: values.headed ?? false,
      model: process.env["CODEX_MOBILE_SMOKE_MODEL"] ?? "gpt-6.1-sol",
      progress: message => console.log(`codex-mobile-browser-smoke: ${message}`)
    });
    console.log(`codex-mobile-browser-smoke: ${report.ok ? "PASS" : "FAIL"} mode=${report.mode}`);
    console.log(`Report: ${report.report}\nScreenshot: ${report.screenshot}`);
    for (const error of report.errors) console.error(error);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(errorMessage(error, process.env["FARFIELD_AUTH_PIN"] ?? "[PIN unavailable]"));
    process.exitCode = 1;
  }
}
