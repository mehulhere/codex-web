# Codex Web

[![Checks](https://github.com/mehulhere/codex-web/actions/workflows/ci.yml/badge.svg)](https://github.com/mehulhere/codex-web/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Your Codex chats, in a browser that fits your phone.**

Codex Web is a self-hosted PWA for reading and continuing chats running on your
own Linux computer. Open a chat from your phone, follow the agent's work, send a
follow-up, and see the same queue on Desktop and the web.

The default is the **Desktop companion**. Set `CODEX_CLI_ONLY=true` for a
standalone Codex CLI installation that does not connect to or require Desktop.
Both modes run commands and tools on your own computer.

> **Your desktop workspace, from your phone. No Codex Cloud tasks.**
>
> Codex Web connects to Codex running on your own computer. Commands, tools,
> tests, and file changes run in that computer's existing workspace. You can
> continue a chat from your phone and return to the same work on Desktop.
> Codex Web does not create a cloud workspace or require uploading your
> repository to a hosted execution service. Your computer must stay awake and
> connected for remote control.

Model requests still go to the provider configured in your Codex installation.
"No Codex Cloud" describes where your workspace and tools run; it does not mean
model inference is offline or runs on your phone.

The interface and local service are named **Codex Mobile**. Package names keep
Farfield's original `@farfield/*` namespace for compatibility.

[Installation](docs/INSTALL.md) · [Configuration](docs/CONFIGURATION.md) ·
[Testing](docs/TESTING.md) · [Privacy](docs/PRIVACY.md) · [Contributing](CONTRIBUTING.md)

## What you can do

| Feature | What it provides |
| --- | --- |
| Shared chats | Browse Desktop projects and chats, read history, and continue conversations. |
| Live work | Follow reasoning, commands, file changes, and pending questions. |
| Follow-up queue | Queue, edit, delete, or steer messages; admitted items are shared with Desktop. |
| Chat controls | Select available models, collaboration modes, and reasoning effort; interrupt active work. |
| Images | Attach images, preview them without cropping, and open larger previews. |
| Phone-friendly UI | Responsive layout, dark/light themes, saved-password login, and home-screen installation. |
| Usage and resets | View usage and explicitly redeem existing resets when the running Desktop host supports these tools. |
| Host monitoring | Opt in to a CPU-temperature check every minute, with a configurable warning. |
| Browser readiness checks | Verify login, sending, reload/resume, and real queue operations before startup reports ready. |

Multi-account router integration is optional and **off by default**. No
multi-account tool is required for ordinary chat access.

## How it works

```text
Phone or browser
      |
      | private HTTPS connection, usually through Tailscale Serve
      v
Codex Web: React PWA + local Node.js HTTP/SSE server
      |
      +-- Codex Desktop IPC: live state and Desktop coordination
      +-- codex app-server: chat history, messages, models, and shared queue
```

In the default mode, run the server on the same computer as Codex Desktop. This is a client for your
existing Codex installation, not a hosted agent service or a replacement for
Codex authentication. Chat requests use the account and permissions configured
in that installation.

## Requirements

- Linux with **Node.js 24+** and **pnpm 10.29.3**.
- For the default `CODEX_CLI_ONLY=false` mode: Codex Desktop running locally,
  with an accessible IPC socket. Desktop is not required when this flag is `true`.
- The `codex` CLI installed, authenticated, and available on `PATH`.
- For remote access: Tailscale on the host and phone, with HTTPS Serve configured.
- For browser tests: Google Chrome. Tests use the included `playwright-core` dependency.
- For persistent service installation: a systemd user session.

Desktop IPC and app-server interfaces can change between releases. This project
validates the protocol with Zod and reports incompatible payloads. Linux is the
supported deployment target; other operating systems have not been verified.

## Quick start: local development

```bash
git clone https://github.com/mehulhere/codex-web.git
cd codex-web
npm install --global pnpm@10.29.3
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open **http://127.0.0.1:4312** on the host. The development API uses port 4311;
Vite proxies `/api` and `/events` to it. Keep Codex Desktop open in the default mode.

### CLI-only setup

Install and authenticate the Codex CLI on the host, then set this in `.env`:

```dotenv
CODEX_CLI_ONLY=true
```

Start with the same commands above. No Desktop app or IPC socket is needed.
CLI-only live checks have been verified on Linux with Codex CLI `0.162.1`.
Chat history, new chats, messages, images, model/reasoning/mode settings, live
updates, queued follow-ups, and interrupts use `codex app-server`. Command and
file-change approvals and user questions appear in the browser; approvals
require an explicit decision and are never automatically accepted.

Desktop pins/project labels, Desktop usage/reset tools, and editing sent
messages are unavailable in CLI-only mode. Projects are grouped by their CLI
working directory. Other server-request extensions (such as dynamic tools or
permission-profile approvals) return an explicit unsupported-request error.
CLI-only live verification is documented in [Testing](docs/TESTING.md).

For a persistent service, password setup, private HTTPS, and iPhone installation,
follow the [installation guide](docs/INSTALL.md). The installer builds production
assets and creates the `start-codex-pwa` command.

## Start and verify an installed PWA

```bash
start-codex-pwa
start-codex-pwa --restart
start-codex-pwa --verify-only
```

The readiness gate opens a fresh mobile browser, logs in, sends a short prompt,
reloads, sends a follow-up, and verifies the responses. It also creates a real
queue record and tests visibility, reload, edit, and deletion. These checks use a
dedicated test chat and consume a small amount of Codex usage. Reports and
screenshots stay in your local state directory.

See [Testing](docs/TESTING.md) for offline regression tests and diagnostics that
do not send messages.

## Privacy and access

- Host it on your own computer and use a private network. Do not expose the
  control server directly to the public internet.
- Remote access can control Codex with the permissions of its chats. Treat the
  password and an authenticated browser session as credentials.
- Conversation APIs and event streams are not stored in the service worker's
  offline cache. Browser state, uploads, diagnostic traces, and test reports can
  still contain sensitive information; see the [data inventory](docs/PRIVACY.md).
- Usage resets require confirmation for each use. Temperature monitoring warns;
  it does not shut down the computer.
- Publishing this source code does not publish or host your running PWA.

This public repository starts from a reviewed source snapshot. It intentionally
excludes private Git history, real chat screenshots, machine configuration,
local credentials, raw traces, and historical project notes.

## Development

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm check:public
```

Most tests use synthetic data and do not need a live Codex account. Browser-based
regression and preview tests require Chrome. Live checks are separate and must
only target the isolated test chat. See [Contributing](CONTRIBUTING.md).

## Keeping up with Codex protocol changes

`pnpm protocol:check` detects drift against the CLI's own generated schemas.
CI regenerates the contracts for recorded releases, and a maintenance agent can
prepare fixes as tested PRs before promoting them on an opted-in host. Desktop
IPC changes also require real browser verification. See
[Protocol maintenance](docs/PROTOCOL-MAINTENANCE.md) for the repair/deployment
sequence and its limits.

## Project layout

```text
apps/server/             HTTP/SSE API, authentication, and host integration
apps/web/                React + Vite PWA
packages/codex-api/      App-server and Desktop IPC clients
packages/codex-protocol/ Zod schemas and protocol types
scripts/                Installation, browser tests, and publication checks
systemd/                User service and watchdog templates
docs/                   Setup, configuration, testing, and privacy guides
```

## Credits and license

Derived from [Farfield](https://github.com/drewcotten/farfield), originally built
by Anshu Chimala. The upstream copyright and MIT permission notice are preserved
in [LICENSE](LICENSE). Dependencies retain their respective licenses.

This is an independent project, not affiliated with or endorsed by OpenAI.
Codex and other product names belong to their respective owners.
