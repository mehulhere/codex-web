# Privacy and local data

Codex Web is self-hosted. The application does not include an analytics SDK or
a project-owned telemetry service. That does not make all activity offline:
Codex sends agent requests to its configured provider, Tailscale provides the
network connection, browser speech recognition may use a vendor service, and
links or remote images in chat content can contact their original hosts.

## Data inventory

| Location | What can be stored |
| --- | --- |
| Codex's own state directory | Existing chats, projects, app-server queue, account state, and Desktop settings. Managed by Codex. |
| `~/.config/codex-mobile/environment` | PWA password and local deployment configuration. Installer sets mode `0600`. |
| `~/.local/state/codex-mobile/sessions.json` | Hashed session identifiers and expiry times. |
| `~/.local/state/codex-mobile/images/` | Uploaded images used by chats. |
| `~/.local/state/codex-mobile/browser-smoke/` | Dedicated test workspace/chat registry, reports, and screenshots. |
| `~/.local/state/codex-mobile/queue-browser-test/` | Real-queue browser reports and screenshots. |
| Repository `traces/`, if explicitly captured | Raw diagnostic traffic that may include conversations and paths. |
| In-memory server buffers and logs | Recent debug/history events, protocol errors, request and service diagnostics. |
| Browser local storage | Theme/display settings, selected chat, connectivity preferences, and an unresolved reset attempt ID. |
| Browser cookie store | HTTP-only authenticated PWA session cookie. |
| Service worker cache | Offline notice, manifest, and app icon; chat APIs and event streams are not cached by it. |

State paths honor `XDG_STATE_HOME` where supported. Browser caches and operating
system backups can retain additional copies. Clearing a browser does not remove
host-side Codex history or uploads.

## Sharing diagnostics

Use invented chat text, generic project names, reserved example domains, and
synthetic identifiers. Prefer a minimal reproduction over raw traces. Review
screenshots for sidebar project names, account information, addresses, browser
chrome, terminal output, and messages. Image metadata also needs review.

`pnpm sanitize:traces` creates reduced fixtures, but automated sanitization is
not proof of privacy. Review every fixture before committing it.

`pnpm check:public` checks repository files for common credential formats, private
configuration/artifacts, and identifiable host/home paths. It reports locations,
not matched values. It is a guardrail, not an exhaustive secret detector or a
license to upload real conversations. Manually review new fixtures and binary
assets too.

## Public repository boundaries

The initial public snapshot contains source, generic tests, dependency metadata,
service templates, and documentation. It omits the previous repository's Git
history, personal agent configuration, screenshots, raw traces, session stores,
private environment files, generated service files, and project-specific plans.
Test account labels, home paths, hostnames, and sample IDs were replaced with
synthetic values. The upstream license and attribution remain intact.

Publishing or contributing source must not upload your installed environment,
Codex state, test reports, or screenshots of real chats. The GitHub repository
owner is publicly visible; clean commit metadata does not hide that ownership.
