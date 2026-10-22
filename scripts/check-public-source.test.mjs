import test from "node:test";
import assert from "node:assert/strict";
import { inspectSource } from "./check-public-source.mjs";

test("allows reserved example data and the configuration template", () => {
  assert.deepEqual(inspectSource(".env.example", "MULTI_ACCOUNT=false"), []);
  assert.deepEqual(inspectSource("test.ts", "/home/example/project\ndemo@example.test\nhttps://desktop.example.ts.net"), []);
});

test("blocks runtime state even if someone force-adds an ignored file", () => {
  for (const filename of [".env", ".env.local", "traces/capture.ndjson", "sessions.json", ".claude/settings.local.json", "private.sqlite"]) {
    assert.ok(inspectSource(filename, "").length > 0);
  }
});

test("reports credential locations without including matched values", () => {
  const secret = "gh" + "p_" + "a".repeat(36);
  const issues = inspectSource("sample.ts", "safe\n" + secret);
  assert.equal(issues[0].line, 2);
  assert.equal(issues[0].reason, "credential-shaped content");
  assert.equal(JSON.stringify(issues).includes(secret), false);
});

test("rejects identifiable paths, hosts, and email addresses", () => {
  for (const value of ["/home/" + "private-person/project", "desktop.tailabcdef.ts." + "net", "person@" + "mail-provider.com"]) {
    assert.ok(inspectSource("sample.ts", value).length > 0);
  }
});
