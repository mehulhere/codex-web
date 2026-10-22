import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { z } = require("zod");
const root = fileURLToPath(new URL("../", import.meta.url));
const baselinePath = path.join(root, "packages/codex-protocol/upstream/schema-manifest.json");
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const FingerprintsSchema = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/).nullable());
export const ManifestSchema = z.object({
  format: z.literal(1), experimental: z.literal(true),
  releases: z.record(VersionSchema, FingerprintsSchema)
}).strict();
const JsonNodeSchema = z.lazy(() => z.union([
  z.null().transform(value => ({ kind: "scalar", value })),
  z.string().transform(value => ({ kind: "scalar", value })),
  z.number().transform(value => ({ kind: "scalar", value })),
  z.boolean().transform(value => ({ kind: "scalar", value })),
  z.array(JsonNodeSchema).transform(value => ({ kind: "array", value })),
  z.record(JsonNodeSchema).transform(value => ({ kind: "object", value }))
]));
const annotations = new Set(["description", "title", "examples", "$comment", "$schema"]);
const schemaMaps = new Set(["properties", "definitions", "$defs", "patternProperties"]);
export const watchedSchemas = [
  "ClientRequest.json", "ServerNotification.json",
  "v1/InitializeParams.json", "v1/InitializeResponse.json",
  ...["ModelList", "CollaborationModeList", "ThreadList", "ThreadRead", "ThreadStart", "ThreadResume",
    "ThreadFork", "ThreadSettingsUpdate", "ThreadDelete", "ThreadInjectItems", "ThreadCompactStart",
    "ThreadUnsubscribe", "ThreadRollback", "ThreadRevert", "TurnStart", "TurnSteer", "TurnInterrupt", "ThreadQueueList", "ThreadQueueAdd",
    "ThreadQueueUpdate", "ThreadQueueDelete", "ThreadQueueStart"]
    .flatMap(name => [`v2/${name}Params.json`, `v2/${name}Response.json`]),
  "v2/TurnCompletedNotification.json", "v2/ThreadQueueChangedNotification.json"
].sort();

function canonicalNode(node, context = "schema") {
  switch (node.kind) {
    case "scalar": return node.value;
    case "array": return node.value.map(value => canonicalNode(value, context === "literal" ? "literal" : "schema"));
    case "object": return Object.fromEntries(Object.entries(node.value)
      .filter(([key]) => context !== "schema" || !annotations.has(key))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => [key, canonicalNode(value, context === "literal" || (context === "schema" && ["const", "enum", "default"].includes(key))
        ? "literal" : context === "schema" && schemaMaps.has(key) ? "map" : "schema")]));
    default: throw new Error("Unsupported schema node");
  }
}
export function schemaFingerprint(schema) {
  return createHash("sha256").update(JSON.stringify(canonicalNode(JsonNodeSchema.parse(schema)))).digest("hex");
}
export function compareFingerprints(expected, actual) {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    .filter(name => expected[name] !== actual[name]);
}
export function acceptSnapshot(manifest, version, fingerprints) {
  const checked = ManifestSchema.parse(manifest);
  return ManifestSchema.parse({ ...checked, releases: { ...checked.releases, [VersionSchema.parse(version)]: fingerprints } });
}
export async function inspectInstalledProtocol(executable = process.env.CODEX_CLI_PATH || "codex") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-web-protocol-"));
  try {
    const home = path.join(directory, "home"); await mkdir(home, { mode: 0o700 });
    const env = { ...process.env, CODEX_HOME: home };
    const versionOutput = execFileSync(executable, ["--version"], { env, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
    const version = VersionSchema.parse(versionOutput.replace(/^codex-cli /, ""));
    const output = path.join(directory, "schema");
    execFileSync(executable, ["app-server", "generate-json-schema", "--experimental", "--out", output], {
      env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024
    });
    const fingerprints = {};
    for (const name of watchedSchemas) {
      const contents = await readFile(path.join(output, name), "utf8").catch(error => {
        const failure = z.object({ code: z.string() }).passthrough().parse(error);
        if (failure.code === "ENOENT") return null;
        throw error;
      });
      fingerprints[name] = contents === null ? null : schemaFingerprint(JSON.parse(contents));
    }
    if (Object.values(fingerprints).every(value => value === null)) throw new Error("No watched app-server schemas were generated");
    return { version, fingerprints: FingerprintsSchema.parse(fingerprints) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { cli: { type: "string" }, "expect-version": { type: "string" }, baseline: { type: "string" } } });
  const command = z.enum(["check", "capture"]).parse(positionals[0] ?? "check");
  if (positionals.length > 1) throw new Error("Usage: protocol-schema.mjs [check|capture] [--cli executable]");
  const destination = values.baseline ? path.resolve(values.baseline) : baselinePath;
  const manifest = ManifestSchema.parse(JSON.parse(await readFile(destination, "utf8")));
  const current = await inspectInstalledProtocol(values.cli);
  if (values["expect-version"] && current.version !== VersionSchema.parse(values["expect-version"])) {
    throw new Error(`Expected Codex ${values["expect-version"]}, received ${current.version}`);
  }
  if (command === "capture") {
    const next = acceptSnapshot(manifest, current.version, current.fingerprints);
    const pending = destination + ".pending";
    await writeFile(pending, JSON.stringify(next, null, 2) + "\n"); await rename(pending, destination);
    console.log(`Recorded Codex ${current.version}: ${watchedSchemas.length} schema fingerprints. This does not prove adapter compatibility; review and test code changes before merging.`);
  } else {
    const expected = manifest.releases[current.version];
    const changed = expected ? compareFingerprints(expected, current.fingerprints) : watchedSchemas;
    if (!expected || changed.length) {
      console.error(`Protocol review required for Codex ${current.version}: ${expected ? "schema drift" : "unverified CLI release"}.`);
      for (const name of changed) console.error(`  ${name}`);
      process.exitCode = 2;
    } else console.log(`PASS: Codex ${current.version} matches ${watchedSchemas.length} recorded app-server schemas. Desktop IPC and runtime behavior require browser verification.`);
  }
}
