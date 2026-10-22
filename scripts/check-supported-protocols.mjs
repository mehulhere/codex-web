import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ManifestSchema } from "./protocol-schema.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = ManifestSchema.parse(JSON.parse(await readFile(new URL("../packages/codex-protocol/upstream/schema-manifest.json", import.meta.url), "utf8")));
const versions = Object.keys(manifest.releases);
if (!versions.length) throw new Error("No verified Codex CLI releases are recorded");
for (const version of versions) {
  // npm supplies a version-scoped CLI; the global installation is left intact.
  const env = { ...process.env }; delete env.CODEX_CLI_PATH;
  execFileSync("npm", ["exec", "--yes", "--package", `@openai/codex@${version}`, "--", "node", "scripts/protocol-schema.mjs", "check", "--expect-version", version], {
    cwd: root, env, stdio: "inherit", timeout: 240_000
  });
}
