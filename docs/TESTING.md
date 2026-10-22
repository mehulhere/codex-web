# Testing

## CLI-only regression and live checks

After `pnpm build`, run `pnpm test:cli-only`. This starts the actual HTTP server
and built PWA against a synthetic app-server executable, opens Chrome, and
tests send/reload/resume, command and file approvals, questions, queued follow-up
visibility/edit/delete, settings, and interruption. A listening fake Desktop
socket must receive zero connections with `CODEX_CLI_ONLY=true`. Separate tests
require Desktop IPC and reject existing-chat sends when the flag is `false` or
unset and IPC has not initialized. No account or model usage is needed.

The normal `pnpm test` includes these checks. `pnpm test:pwa` also accepts a
CLI-only server: it reads the authenticated mode from health state and requires
the correct connection status. Real send/reload/resume and queue checks must
use a dedicated registered test chat and consume Codex usage. When testing a
candidate alongside an installed PWA, use a separate port, private
`XDG_STATE_HOME`, and `CODEX_MOBILE_PWA_URL` to isolate its test chat and reports.
Never stop Desktop or change the production service to simulate a CLI-only host.

## Source and regression tests

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm check:public
pnpm protocol:verify-releases
```

These use synthetic data rather than your Desktop chats. Chrome is required for
browser smoke-tester regression cases and visualization preview tests. They do
not send prompts to a live Codex account.

Run a focused web test while iterating:

```bash
pnpm --filter @farfield/web exec vitest run test/conversation-item.test.tsx
```

The smoke tester has browser fixtures that deliberately simulate broken pages,
missing password metadata, unavailable backends, malformed responses, disabled
controls, runtime failures, horizontal overflow, and a rejected resumed send.
Separate startup-script tests verify that a running service or a passing send
check cannot mask a failing browser or queue gate.

## Live readiness checks

After installing the service:

```bash
start-codex-pwa --verify-only
```

This runs two Playwright scripts:

| Script | Checks |
| --- | --- |
| `scripts/pwa-smoke-test.mjs` | Password login, protected API, history, layout, SSE, models, sidebar, composer, sending/reply, reload, and resumed sending/reply. |
| `scripts/pwa-queue-test.mjs` | Real admitted queue record, mobile/desktop visibility, reload, browser edit, and browser deletion verified against the native queue API. |

The tests create/reuse only their dedicated chat and verify its isolated
workspace before sending or changing its queue. A test chat registry is generated
locally; no real chat IDs ship in this repository. Tests spend a small amount of
Codex quota. They never redeem usage resets.

The startup wrapper loads the private environment file. To run individual
scripts directly, securely load `FARFIELD_AUTH_PIN` and required settings into
your environment first:

```bash
pnpm test:pwa
pnpm test:pwa-queue
pnpm test:pwa --read-only
```

Read-only mode is useful for diagnostics, but does not satisfy startup readiness.
Use `--headed` with the smoke script to see its browser. Choose a model through
`CODEX_MOBILE_SMOKE_MODEL` if the default is unavailable.

Reports and screenshots are private local artifacts. See [Privacy](PRIVACY.md).
Do not attach them to public issues without inspecting and redacting them.

CI runs source/regression tests, not live account tests. Reset redemption tests
use a fake Desktop pipe and mocked browser requests; they must never spend a real
reset credit.
