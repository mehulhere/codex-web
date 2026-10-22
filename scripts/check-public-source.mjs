import { execFileSync } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKED_PATH = /(?:^|\/)(?:\.env(?:\..+)?|\.claude|\.codex|traces|reports|artifacts|test-results|playwright-report|sessions\.json|environment|screenshot\.png|Done\.md)(?:\/|$)|\.(?:sqlite(?:-[a-z]+)?|db|pem|key)$/i;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/
];
const EXAMPLE_USERS = new Set(["example", "testuser", "user", "username"]);

export function inspectSource(name, source) {
  const issues = [];
  if (name !== ".env.example" && BLOCKED_PATH.test(name)) issues.push({ line: 1, reason: "private configuration or runtime artifact" });
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (SECRET_PATTERNS.some(pattern => pattern.test(line))) issues.push({ line: index + 1, reason: "credential-shaped content" });
    for (const match of line.matchAll(/\/(?:var\/home|home|Users)\/([A-Za-z0-9_.-]+)\//g)) {
      if (!EXAMPLE_USERS.has(match[1])) issues.push({ line: index + 1, reason: "identifiable home path" });
    }
    for (const match of line.matchAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\b/gi)) {
      if (!match[0].includes(".example.")) issues.push({ line: index + 1, reason: "non-example tailnet hostname" });
    }
    for (const match of line.matchAll(/[A-Za-z0-9_.+*%-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      const domain = match[1].toLowerCase();
      if (!/^(?:example\.(?:com|net|org|test)|.+\.(?:example|invalid|test))$/.test(domain)) {
        issues.push({ line: index + 1, reason: "non-example email address" });
      }
    }
    if (/\b[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(line)) {
      issues.push({ line: index + 1, reason: "timestamp-derived identifier requires synthetic replacement" });
    }
  }
  return issues;
}

export async function checkPublicSource(root) {
  const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))];
  const findings = [];
  for (const name of files) {
    const filename = path.join(root, name);
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) { findings.push(`${name}:1: only regular source files may be published`); continue; }
    let source;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(filename)); }
    catch { findings.push(`${name}:1: binary asset requires explicit manual privacy review`); continue; }
    for (const issue of inspectSource(name, source)) findings.push(`${name}:${issue.line}: ${issue.reason}`);
  }
  return { count: files.length, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkPublicSource(process.cwd());
  if (result.findings.length) {
    console.error(result.findings.join("\n"));
    process.exitCode = 1;
  } else console.log(`PASS: checked ${result.count} source files for blocked artifacts and common privacy patterns. Manual review is still required.`);
}
