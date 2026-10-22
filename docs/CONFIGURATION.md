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
