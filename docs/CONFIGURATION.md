# Configuration

Start with `.env.example` and copy it to `.env` for local development. The server
loads the repository-root `.env`; existing process environment values take
precedence. Restart the server after changing environment settings. Never commit
`.env` or a real service environment file.

The installed systemd service also reads `~/.config/codex-mobile/environment`.
The startup wrapper reads that file for browser verification. Put the password
and startup-test settings there so both processes use the same values.

| Variable | Purpose / default |
| --- | --- |
| `MULTI_ACCOUNT` | Exactly `true` or `false`; default `false`. Enables router account lists, pool quotas, and account-status polling/endpoints. |
| `CODEX_CLI_ONLY` | Exactly `true` or `false`; default `false`. With `false`, keeps Desktop IPC and Desktop ownership behavior. With `true`, uses only the authenticated CLI app-server and skips all Desktop connections, discovery, sidebar/queue state reads, and Desktop usage/reset tools. Restart after changing. |
| `HOST` | API bind address; default `127.0.0.1`. The service template sets `0.0.0.0`; restrict network access to trusted clients. |
| `PORT` | API port; development defaults to `4311`, installed service to `4312`. |
| `FARFIELD_SERVE_WEB` | `1` serves built `apps/web/dist` assets from the API server. |
| `FARFIELD_AUTH_PIN` | Remote-access password. Required when binding outside loopback. |
| `FARFIELD_AUTH_COOKIE_SECURE` | Secure-cookie flag; installer uses `1` for HTTPS. |
| `FARFIELD_AUTH_COOKIE_NAME` | Session cookie name; default `farfield_session`. |
| `FARFIELD_SESSION_TTL_SECONDS` | Sliding session lifetime; default `604800` (7 days), maximum 30 days. |
| `FARFIELD_REMOTE_DEBUG_ENABLED` | `1` enables remote debug endpoints; default off. Local debug remains available. |
| `CODEX_CLI_PATH` | Explicit `codex` executable path; otherwise resolved from the environment. |
| `CODEX_HOME` | Codex state root; default `~/.codex`. |
| `CODEX_IPC_SOCKET` | Explicit Desktop IPC endpoint. |
| `CODEX_APP_TOOLS_PIPE_PATH` | Optional Desktop host tool pipe for usage/reset support; otherwise discovered locally. |
| `CODEX_MOBILE_PWA_URL` | HTTPS origin for startup tests; otherwise derived from Tailscale Serve status. |
| `CODEX_MOBILE_SMOKE_MODEL` | Model for live test prompts; default `gpt-6.1-sol`. Select an available model if needed. |
| `FARFIELD_LOG_RAW_PROTOCOL_ERRORS` | `1` enables more detailed protocol error logs; keep private. |
| `LOG_LEVEL` | Server log level; default `info`. |

`XDG_CONFIG_HOME` and `XDG_STATE_HOME` are supported where used by installation
and runtime storage. Standard locations are listed in [Privacy](PRIVACY.md).
The supplied systemd EnvironmentFile path uses the normal home configuration
location; custom XDG layouts may require adapting that unit.

## Optional multi-account integration

Set `MULTI_ACCOUNT=true` only when your separate `codex-multi-auth` installation
provides its router status data and command. The integration reads that local
state; this repository does not install or configure a router or manage account
credentials. With the setting off, single-account usage and resets still use the
Desktop host's tools, when supported.

Changing this switch needs a server restart, not a frontend rebuild. Changing
application source still requires a build.

## CLI-only mode

Leave `CODEX_CLI_ONLY=false` for the Desktop companion. Set it to `true` only
for a standalone CLI installation. For an installed service, put it in the
private service environment file too; process environment values override `.env`.
The server advertises the mode through authenticated health state, so the same
frontend build supports both modes. Invalid values stop startup with an error.

CLI-only mode inherits the CLI's account, sandbox and approval policy; enabling
it does not grant permissions or change authentication. Run it as the same OS
user and with the same `CODEX_HOME` as the CLI whose chats you want to continue.
The PWA owns the turns it starts. Concurrent control of a running turn from an
independent terminal process is not promised. Stop that turn before resuming it
from the PWA. Local follow-ups queued during a PWA turn survive browser reloads,
but remain in the server's memory and do not survive a PWA service restart.

Desktop-specific controls are hidden or return HTTP 501. Sent-message editing
is disabled because this client's legacy rollback action is not supported by
the verified CLI contract. Command/file approvals support one-time decisions;
session-wide policy amendments are not offered. Unknown server requests fail
explicitly instead of receiving an automatic approval. Pending approvals expire
when their turn completes, the server resolves them, the transport closes, or
after ten minutes. No approval is persisted.

The native CLI queue belongs to the app-server process that accepted it. To
explicitly admit a text-only queue entry without starting a turn, authenticated
CLI-only clients can `POST /api/threads/:threadId/queue` with `{ "text": "..." }`.
The chat must be idle with no local follow-ups. Its idle engine is released
before admission so Codex does not immediately consume the entry. The response
contains `messageId`; the existing queue read/edit/delete/steer routes operate
on that same native record. Resuming or starting the chat can consume it. The
live verifier uses this route in CLI-only mode instead
of assuming a separate CLI process shares Desktop's admitted queue.
