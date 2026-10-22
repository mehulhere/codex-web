import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runPwaSmokeTest } from "./pwa-smoke-test.mjs";

async function fixture(mode = "healthy") {
  const writes = [];
  let reply = "A previous assistant response";
  let cwd = "/workspace";
  let messageCount = 0;
  const script = `
    async function boot() {
      const routes = ['/api/health','/api/threads?limit=80','/api/threads/thread-smoke?includeTurns=true','/api/threads/thread-smoke/settings','/api/models'];
      const responses = await Promise.all(routes.map(route => fetch(route)));
      const history = await responses[2].json();
      document.body.innerHTML = '<button aria-label="Open tasks">Tasks</button><span aria-label="Desktop reconnecting">Connected</span><div role="log" aria-label="Conversation">A previous assistant response</div><select aria-label="Model"><option value="model-test">Test model (model-test)</option></select><textarea placeholder="Message Codex…" ${mode === "disabled-composer" ? "disabled" : ""}></textarea><button aria-label="Send message" disabled>Send</button><button aria-label="Refresh task">Refresh</button>';
      document.querySelector('textarea').oninput = e => document.querySelector('[aria-label="Send message"]').disabled = !e.target.value;
      document.querySelector('[role="log"]').textContent = history.thread?.turns[0]?.items[0]?.text ?? 'No messages';
      ${mode === "horizontal-overflow" ? "document.querySelector('[role=\"log\"]').insertAdjacentHTML('beforeend', '<div style=\"width:1200px\">Wide content</div>');" : ""}
      document.querySelector('[aria-label="Send message"]').onclick = async () => {
        const response = await fetch('/api/threads/thread-smoke/messages', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:document.querySelector('textarea').value})});
        if (response.ok) document.querySelector('[role="log"]').textContent = (await response.json()).reply;
        document.querySelector('textarea').value = '';
      };
      document.querySelector('[aria-label="Refresh task"]').onclick = boot;
      document.querySelector('[aria-label="Open tasks"]').onclick = () => {
        const aside = document.createElement('aside');
        aside.innerHTML = '<div>Codex Mobile</div><button>A test chat</button><button aria-label="Close tasks">Close</button>';
        aside.querySelector('[aria-label="Close tasks"]').onclick = () => aside.remove();
        document.body.append(aside);
      };
      const source = new EventSource('/events');
      source.onopen = () => document.querySelector('[aria-label="Desktop reconnecting"]')?.setAttribute('aria-label', 'Desktop connected');
      ${mode === "runtime-error" ? "setTimeout(() => { throw Error('Synthetic rendering failure'); }, 0);" : ""}
    }
    if (document.cookie.includes('fixture=1')) boot();
    else document.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const response = await fetch('/api/auth/login', {method:'POST',body:'{}'});
      if (response.ok) location.href = '/threads/thread-smoke';
    };
  `;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST") writes.push(url.pathname);
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"type":"state","state":{}}\n\n');
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(mode === "blank-page" ? "<html><body></body></html>" : `<html><body><form aria-label="Unlock Codex Mobile"><input name="username" autocomplete="username" value="codex-mobile" style="display:none"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${mode === "missing-autofill" ? "off" : "current-password"}" placeholder="Enter password"><button type="submit">Unlock</button></form><script>${script}</script></body></html>`);
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const auth = req.headers.cookie?.includes("fixture=1");
    if (url.pathname === "/api/auth/login") {
      res.setHeader("Set-Cookie", "fixture=1; Path=/; SameSite=Strict");
      res.end('{"ok":true,"expiresAt":null}');
    } else if (url.pathname === "/api/auth/logout") {
      res.end('{"ok":true}');
    } else if (!auth) {
      res.writeHead(401); res.end('{"ok":false}');
    } else if (url.pathname === "/api/health") {
      res.end(JSON.stringify({ ok: true, state: { appReady: mode !== "backend-not-ready", ipcConnected: true, ipcInitialized: true, requiresAuth: true, multiAccount: false } }));
    } else if (url.pathname === "/api/threads") {
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        cwd = JSON.parse(Buffer.concat(chunks).toString()).cwd;
        res.end(JSON.stringify({ok:true,threadId:"thread-smoke",thread:{id:"thread-smoke",preview:"PWA smoke test",createdAt:1,updatedAt:1,cwd}}));
      } else res.end('{"data":[{"id":"thread-smoke","preview":"Test chat","createdAt":1,"updatedAt":1}]}');
    } else if (url.pathname.endsWith("/messages")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      messageCount += 1;
      if (mode === "followup-error" && messageCount >= 3) {
        res.writeHead(503); res.end('{"ok":false,"error":"AppServerResumeThreadResponse did not match"}');
      } else {
        reply = body.text.match(/PWA_SMOKE_[a-zA-Z0-9_]+/)[0];
        res.end(JSON.stringify({ok:true,reply}));
      }
    } else if (url.pathname.endsWith("/settings")) {
      res.end('{"ok":true,"model":"model-test","modelProvider":"openai","reasoningEffort":"high"}');
    } else if (url.pathname === "/api/models") {
      res.end('{"data":[],"nextCursor":null}');
    } else if (url.pathname === "/api/threads/thread-smoke") {
      if (mode === "schema-error") {
        res.writeHead(500); res.end('{"ok":false,"error":"AppServerResumeThreadResponse did not match"}');
      } else res.end(JSON.stringify({ok:true,thread:{id:"thread-smoke",cwd,turns:[{id:"turn-1",status:"completed",items:[{id:"assistant-1",type:"agentMessage",text:reply}]}],requests:[]}}));
    } else { res.writeHead(404); res.end("{}"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(path.join(os.tmpdir(), "pwa-smoke-test-"));
  return {
    options: { origin: `http://127.0.0.1:${server.address().port}`, pin: "12345678", outputDirectory: directory, timeoutMs: 1_500 },
    writes,
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(directory, { recursive: true });
    }
  };
}

test("browser smoke verifies login, history, controls, SSE and a session-preserving reload", async () => {
  const app = await fixture();
  try {
    const result = await runPwaSmokeTest(app.options);
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.ok(result.checks.includes("session-reload"));
    assert.ok(result.checks.includes("password-manager-form"));
    assert.ok(result.checks.includes("composer-controls"));
    assert.ok(app.writes.every(route => ["/api/auth/login", "/api/auth/logout"].includes(route)));
    assert.ok((await readFile(result.screenshot)).length > 100);
    const report = await readFile(result.report, "utf8");
    assert.equal(report.includes(app.options.pin), false);
  } finally { await app.close(); }
});

for (const mode of ["blank-page", "missing-autofill", "backend-not-ready", "schema-error", "disabled-composer", "runtime-error", "horizontal-overflow"]) {
  test(`browser smoke fails for ${mode}, even when the shell returns HTTP 200`, async () => {
    const app = await fixture(mode);
    try {
      const result = await runPwaSmokeTest(app.options);
      assert.equal(result.ok, false);
      assert.ok(result.errors.length > 0);
      assert.ok((await readFile(result.screenshot)).length > 100);
    } finally { await app.close(); }
  });
}

test("browser send gate reuses only its dedicated chat and verifies a resumed follow-up", async () => {
  const app = await fixture();
  try {
    for (let run = 0; run < 2; run += 1) {
      const result = await runPwaSmokeTest({...app.options, send:true});
      assert.equal(result.ok, true, result.errors.join("; "));
      assert.ok(result.checks.includes("resumed-browser-send-and-assistant-reply"));
    }
    assert.equal(app.writes.filter(route => route === "/api/threads").length, 1);
    assert.equal(app.writes.filter(route => route.endsWith("/messages")).length, 5);
  } finally { await app.close(); }
});

test("browser send gate fails when the resumed follow-up is rejected", async () => {
  const app = await fixture("followup-error");
  try {
    const result = await runPwaSmokeTest({...app.options, send:true});
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes("503")));
  } finally { await app.close(); }
});
