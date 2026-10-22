import test from "node:test";
import assert from "node:assert/strict";
import { schemaFingerprint, compareFingerprints, acceptSnapshot, ManifestSchema, watchedSchemas } from "./protocol-schema.mjs";

test("schema hashes ignore annotation changes and property ordering", () => {
  assert.equal(schemaFingerprint({ type: "object", description: "old", properties: { a: { type: "string" } } }),
    schemaFingerprint({ properties: { a: { description: "new", type: "string" } }, type: "object", title: "Updated docs" }));
});
test("actual properties named description and title are still tracked", () => {
  assert.notEqual(schemaFingerprint({ properties: { description: { type: "string" } } }),
    schemaFingerprint({ properties: { description: { type: "integer" } } }));
});
test("literal enum, const, and default values retain annotation-named keys", () => {
  for (const key of ["const", "enum", "default"]) {
    const left = { [key]: [{ description: "before", nested: { title: "one" } }] };
    const right = { [key]: [{ description: "after", nested: { title: "one" } }] };
    assert.notEqual(schemaFingerprint(left), schemaFingerprint(right));
  }
});
test("field additions, removals, requiredness, nullability and limits change fingerprints", () => {
  const original = { type: "object", properties: { field: { type: "string" } } };
  for (const changed of [
    { type: "object", properties: {} },
    { type: "object", properties: { field: { type: "string" }, added: { type: "number" } } },
    { ...original, required: ["field"] },
    { type: "object", properties: { field: { type: ["string", "null"] } } },
    { type: "object", properties: { field: { type: "string", minLength: 3 } } }
  ]) assert.notEqual(schemaFingerprint(original), schemaFingerprint(changed));
});
test("compares added, removed, and missing schema files", () => {
  assert.deepEqual(compareFingerprints({ a: "1", b: "2", c: null }, { a: "1", c: "3", d: "4" }), ["b", "c", "d"]);
});
test("recording a new release retains previously verified releases", () => {
  const fingerprints = { "v2/ThreadReadResponse.json": "a".repeat(64) };
  const initial = { format: 1, experimental: true, releases: { "1.0.0": fingerprints } };
  const next = acceptSnapshot(initial, "1.1.0", fingerprints);
  assert.deepEqual(Object.keys(next.releases), ["1.0.0", "1.1.0"]);
  assert.deepEqual(Object.keys(initial.releases), ["1.0.0"]);
});
test("rejects malformed baselines and version strings", () => {
  assert.equal(ManifestSchema.safeParse({ format: 1, experimental: false, releases: {} }).success, false);
  assert.throws(() => acceptSnapshot({ format: 1, experimental: true, releases: {} }, "arbitrary command", {}));
});
test("watches resume, shared queue, and initialization boundaries", () => {
  for (const name of ["v2/ThreadResumeResponse.json", "v2/ThreadQueueListResponse.json", "v1/InitializeResponse.json", "ClientRequest.json", "ServerNotification.json", "v2/ThreadRollbackParams.json", "v2/ThreadRevertParams.json"]) assert.ok(watchedSchemas.includes(name));
});

test("CLI drift check fails without accepting new fields or changing its baseline", async () => {
  const { mkdtemp, writeFile, readFile, rm, chmod } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os"); const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const directory = await mkdtemp(path.join(os.tmpdir(), "protocol-drift-test-"));
  try {
    const executable = path.join(directory, "fake-codex");
    const baseline = path.join(directory, "baseline.json");
    const marker = path.join(directory, "change");
    await writeFile(baseline, JSON.stringify({ format: 1, experimental: true, releases: {} }));
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
if (fs.existsSync(path.join(process.env.CODEX_HOME, 'auth.json'))) throw new Error('Generator received account state');
if (process.argv.includes('--version')) { console.log('codex-cli 9.9.9'); process.exit(0); }
const out=process.argv[process.argv.indexOf('--out')+1]; fs.mkdirSync(path.join(out,'v2'),{recursive:true});
const properties=fs.existsSync(${JSON.stringify(marker)})?{thread:{type:'object'},added:{type:'string'}}:{thread:{type:'object'}};
fs.writeFileSync(path.join(out,'v2/ThreadResumeResponse.json'),JSON.stringify({type:'object',properties}));
`);
    await chmod(executable, 0o700);
    const script = fileURLToPath(new URL("./protocol-schema.mjs", import.meta.url));
    const run = command => spawnSync(process.execPath, [script, command, "--cli", executable, "--baseline", baseline], { encoding: "utf8" });
    assert.equal(run("check").status, 2);
    assert.equal(run("capture").status, 0);
    const accepted = await readFile(baseline, "utf8");
    assert.equal(run("check").status, 0);
    await writeFile(marker, "changed");
    const drift = run("check");
    assert.equal(drift.status, 2);
    assert.match(drift.stderr, /ThreadResumeResponse/);
    assert.equal(await readFile(baseline, "utf8"), accepted);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
