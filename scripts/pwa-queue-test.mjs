import { createRequire } from "node:module";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const { z } = require("zod");
const { AppServerReadThreadResponseSchema } = require("@farfield/protocol");
const { HealthResponseSchema, QueuedFollowUpsResponseSchema, QueuedFollowUpActionResponseSchema } = await import("../apps/server/dist/http-schemas.js");
const { AppServerClient } = await import("../packages/codex-api/dist/index.js");
const RegistrySchema = z.object({ origin: z.string().url(), threadId: z.string().min(1), cwd: z.string().min(1) }).strict();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateHome = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local/state");
const state = path.join(stateHome, "codex-mobile/browser-smoke");
const registry = RegistrySchema.parse(JSON.parse(await readFile(path.join(state, "test-thread.json"), "utf8")));
const pin = z.string().min(1).parse(process.env.FARFIELD_AUTH_PIN);
if (registry.cwd !== path.join(state, "workspace")) throw new Error("Queue test registry points outside its isolated workspace");
const output = path.join(stateHome, "codex-mobile/queue-browser-test");
await mkdir(output, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(path.join(output, "run-"));
const api = new AppServerClient({ executablePath: process.env.CODEX_CLI_PATH || "codex", cwd: root, userAgent: "pwa-real-queue-test" });
const report = { ok: false, checks: [], errors: [], screenshot: path.join(directory, "queue.png") };
let browser;
let context;
let page;
let queuedId;
let cliOnly = false;
const queueUrl = `${registry.origin}/api/threads/${encodeURIComponent(registry.threadId)}/queue`;
async function queueText(id) {
  if (!cliOnly) {
    const message = (await api.listQueuedSubmissions(registry.threadId)).find(message => message.id === id);
    return message?.input.filter(part => part.type === "text").map(part => part.text).join("\n");
  }
  const response = await context.request.get(queueUrl);
  if (!response.ok()) throw new Error("CLI queue read failed");
  return QueuedFollowUpsResponseSchema.parse(await response.json()).messages.find(message => message.id === id)?.text;
}
async function deleteRecord(id) {
  if (!cliOnly) return api.deleteQueuedSubmission(registry.threadId, id);
  const response = await context.request.delete(`${queueUrl}/${encodeURIComponent(id)}`);
  if (!response.ok()) throw new Error("CLI queue cleanup failed");
  return true;
}
try {
  const history = AppServerReadThreadResponseSchema.parse(await api.readThread(registry.threadId, false));
  if (history.thread.cwd !== registry.cwd) throw new Error("Queue test chat does not belong to its isolated workspace");
  const text = `PWA queue test. Do not use tools, access files, or change anything. Reply with exactly this token and nothing else: PWA_QUEUE_${randomUUID().replaceAll("-", "")}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", error => report.errors.push(error.message.replaceAll(pin, "[redacted]").slice(0, 300)));
  await page.goto(`${registry.origin}/threads/${registry.threadId}`);
  const password = page.getByRole("form", { name: "Unlock Codex Mobile" }).getByLabel("Password", { exact: true });
  await password.fill(pin);
  await password.press("Enter");
  await page.getByRole("log", { name: "Conversation" }).waitFor();
  const healthResponse = await context.request.get(`${registry.origin}/api/health`);
  if (!healthResponse.ok()) throw new Error("Could not read authenticated runtime mode");
  cliOnly = HealthResponseSchema.parse(await healthResponse.json()).state.cliOnly;
  if (cliOnly) {
    const response = await context.request.post(queueUrl, { data: { text } });
    if (!response.ok()) throw new Error("CLI queue admission failed");
    queuedId = QueuedFollowUpActionResponseSchema.parse(await response.json()).messageId;
  } else {
    queuedId = (await api.addQueuedSubmission(registry.threadId, [{ type: "text", text, text_elements: [] }], randomUUID())).id;
  }
  if (await queueText(queuedId) !== text) throw new Error("Real app-server queue did not retain the test message");
  report.checks.push(cliOnly ? "real-cli-owned-queue-created" : "real-desktop-shared-queue-created");
  const queue = page.getByRole("region", { name: "Queued follow-ups" });
  await queue.getByText(text, { exact: true }).waitFor();
  report.checks.push("real-queued-message-visible-on-mobile");
  await page.reload();
  await queue.getByText(text, { exact: true }).waitFor();
  report.checks.push("queued-message-visible-after-reload");
  await queue.getByRole("button", { name: `Edit ${text}`, exact: true }).click();
  const edited = `${text}_EDITED`;
  await queue.getByLabel("Edit queued message", { exact: true }).fill(edited);
  await queue.getByRole("button", { name: "Save queued message", exact: true }).click();
  await queue.getByText(edited, { exact: true }).waitFor();
  if (await queueText(queuedId) !== edited) throw new Error("PWA edit did not reach the real queue");
  report.checks.push("browser-edit-persisted-to-real-queue");
  await page.screenshot({ path: report.screenshot });
  await page.setViewportSize({ width: 1366, height: 900 });
  await queue.getByText(edited, { exact: true }).waitFor();
  report.checks.push("real-queued-message-visible-on-desktop");
  await queue.getByRole("button", { name: `Delete ${edited}`, exact: true }).click();
  await queue.getByText(edited, { exact: true }).waitFor({ state: "hidden" });
  if (await queueText(queuedId) !== undefined) throw new Error("PWA delete did not remove the real queued record");
  report.checks.push("browser-delete-removed-real-queue-record");
  queuedId = undefined;
  if (report.errors.length > 0) throw new Error("Browser reported a runtime error");
  report.ok = true;
} catch (error) {
  report.errors.push(z.instanceof(Error).parse(error).message.replaceAll(pin, "[redacted]").slice(0, 1_000));
  if (page) await page.screenshot({ path: report.screenshot }).catch(() => undefined);
} finally {
  if (queuedId) {
    try { await deleteRecord(queuedId); }
    catch { report.errors.push("Test record cleanup could not be confirmed"); report.ok = false; }
  }
  if (context) await context.request.post(`${registry.origin}/api/auth/logout`).catch(() => undefined);
  if (browser) await browser.close();
  await api.close();
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
}
console.log(`${report.ok ? "PASS" : "FAIL"}: real queue visibility, reload, edit and delete`);
console.log(`Report: ${path.join(directory, "report.json")}`);
if (!report.ok) { for (const error of report.errors) console.error(error); process.exitCode = 1; }
