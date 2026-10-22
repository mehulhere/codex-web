# Protocol maintenance

Codex updates can change the app-server wire format. This project records
structural fingerprints for the official generated schemas used by its client,
including initialization, model/mode discovery, thread operations, shared queue,
and turn operations. The full request and notification catalogs also track RPC
method availability and mappings, including legacy boundaries whose generated
files may be absent. The generator runs with a new temporary `CODEX_HOME`, does
not open a chat or read account state, and its temporary output is removed.

## Commands

```bash
pnpm protocol:check
pnpm protocol:check --cli /absolute/path/to/codex
pnpm protocol:capture --cli /absolute/path/to/codex
pnpm protocol:verify-releases
```

`check` compares the selected CLI with the committed baseline. Exit code 0 means
the watched schemas match; exit code 2 means a release or contract needs review.
Other failures indicate a tool or validation error. `CODEX_CLI_PATH` selects the
CLI when `--cli` is omitted. A Desktop-bundled CLI and a terminal CLI may have
different versions, so check both when they are used by the installation.

`capture` records a release without removing previously recorded versions.
It does **not** modify validators or prove runtime compatibility. Accept a new
baseline only alongside the necessary adapter changes and regression tests.
Descriptions, titles, and documentation examples do not change fingerprints;
actual fields with those names are still tracked. Requiredness, field types,
nullability, references, and constraints remain part of the fingerprint.

The baseline contains version numbers, schema names, and hashes only. It contains
no account information, local paths, machine addresses, raw payloads, or generated
conversation data. Experimental methods are included consistently because some
existing client features use them.

`verify-releases` obtains each recorded CLI release through a version-scoped npm
execution and checks its output. It verifies the requested version was actually
selected and leaves the global CLI installation intact. CI runs this check as
well as the regular build, type checks, tests, and public-source guard.

## Automatic repair and deployment

A maintainer can configure a trusted maintenance agent to run this sequence:

1. Check the installed CLI and the newest stable official `@openai/codex` release
   in isolation. Avoid global CLI or Desktop upgrades as part of this process.
2. If nothing changed and browser verification is healthy, leave the source and
   deployment intact. A changed fingerprint is a trigger for investigation.
3. Work from a clean public-source branch. Inspect the official generated types
   and update the strict Zod validators and affected consumers. Add synthetic
   regression tests for the changed shape and preserve support for deployed
   versions. Never solve a mismatch by accepting arbitrary extra fields.
4. Record the new baseline, run `pnpm build`, `pnpm typecheck`, `pnpm lint`,
   `pnpm test`, `pnpm protocol:verify-releases`, and `pnpm check:public`.
5. Open an update PR and wait for its exact commit's CI to pass. Run the real
   send/resume and shared-queue browser checks against an isolated candidate
   instance on the deployment host, using only its dedicated test chat.
6. Where the operator has explicitly enabled automatic promotion, merge that
   tested PR and deploy the exact merged commit from a separate clean release
   directory. Keep the previous service definitions and startup wrapper for
   rollback. Never reset or overwrite an existing dirty checkout.
7. Run the installed startup gate after promotion. If it fails, restore the
   previous service configuration, restart it, and verify the restored app.
   Report failures that need operator intervention.

Scheduling is an operator choice, not an implicit behavior of every clone.
Codex Desktop automations can run this loop using an existing signed-in account;
other installations can use their own maintenance agent. Agent repairs and live
browser checks consume Codex usage, require a running host, and may need network
access. Unchanged local schema generation itself requires no model request.

## Limits

The generated contract covers **CLI app-server**, not undocumented Desktop IPC,
Desktop ownership/routing, or canonical history patches. Those paths still need
synthetic fixtures and real host browser checks. Matching hashes do not prove
that behavior is unchanged, and passing tests cannot guarantee that every future
breaking change can be repaired automatically.

When a change cannot be understood or verified, stop promotion and report the
specific failing boundary. Preserve strict validation and the last verified
service instead of installing an unverified patch. Never publish raw local logs,
chats, traces, test registries, passwords, or screenshots in an update PR.
