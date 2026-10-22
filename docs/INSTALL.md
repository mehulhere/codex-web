# Installation

Use the requirements and dependency installation steps in the [README](../README.md)
first. Keep Codex Desktop running and confirm that `codex` is on `PATH`.

## 1. Check local access

```bash
pnpm dev
```

Open `http://127.0.0.1:4312` on the host and confirm chats appear. Stop development
mode before installing the service; both use port 4312.

If the Desktop socket is not detected, set `CODEX_IPC_SOCKET` to its actual
location. The Linux default is `${CODEX_HOME:-~/.codex}/ipc/ipc.sock`. See
[Configuration](CONFIGURATION.md) for overrides.

## 2. Configure private HTTPS

Install and authenticate Tailscale on the host and phone. On the host:

```bash
tailscale up
sudo tailscale serve --bg http://127.0.0.1:4312
tailscale serve status
```

Use the HTTPS URL reported by Tailscale, not an address copied from another
installation. The Serve target becomes reachable after the service starts.
Tailscale administrative privileges and tailnet policy depend on your setup.
Use Serve for private tailnet access; do not enable public Funnel access.

## 3. Install the user service

```bash
./scripts/install-user-service.sh install
```

The installer builds the app, creates a private configuration file at
`~/.config/codex-mobile/environment`, installs the systemd user service and
watchdog, and adds `start-codex-pwa` under `~/.local/bin`. Add that directory to
`PATH` if needed. The service serves the built frontend and API from one Node.js
process on port 4312.

A generated eight-digit password is printed once. Keep that output private.
The environment key is named `FARFIELD_AUTH_PIN` for compatibility; the UI uses
an ordinary password input with password-manager metadata. You can replace the
value with a stronger password in the environment file. Maintain valid shell and
systemd EnvironmentFile quoting, because both read this file.

The installer runs browser readiness checks and reports failure if they do not
pass. Have Chrome, Codex Desktop, and the private HTTPS address ready first.
These checks send small prompts in a dedicated test chat and use Codex quota.

## 4. Install on your phone

1. Connect the phone to the same tailnet.
2. Open the reported HTTPS URL in Safari or another supported browser.
3. Enter the password. If offered, save it with username `codex-mobile`.
4. On iPhone, choose **Share → Add to Home Screen**. On other browsers, use the
   available install-PWA action.

HTTPS is required for microphone access. Voice transcription also depends on
browser speech-recognition support, permissions, and potentially the browser
vendor's speech service. Password-manager prompts are controlled by the browser.

## Routine operations

```bash
start-codex-pwa
start-codex-pwa --restart
start-codex-pwa --verify-only
./scripts/install-user-service.sh status
journalctl --user -u codex-mobile.service -f
```

Startup readiness requires the full browser gate. A running process or an HTTP
health response alone does not prove that sending and resuming work.

To update, review and pull changes, install locked dependencies, then rerun the
installer. Restarting alone does not rebuild changed TypeScript or frontend code.

```bash
git pull --ff-only
pnpm install --frozen-lockfile
./scripts/install-user-service.sh install
```

## Usage and host monitoring

- **Usage and resets:** open the top-bar or sidebar control. Availability depends
  on the running Desktop host exposing usage tools. Redeeming requires an existing
  reset, an eligible usage window, and explicit confirmation. No credits are
  purchased automatically. An interrupted redemption retains its attempt ID.
- **CPU temperature:** enable **Environment → Check CPU every minute**. Choose a
  warning threshold. Readings are best-effort, may be unavailable on unsupported
  sensors, and are marked stale after errors. Phone background timers can pause;
  the app refreshes when visible again. This never shuts down the host.
- **Multiple accounts:** disabled by default. See [Configuration](CONFIGURATION.md).

## Troubleshooting

| Problem | Check |
| --- | --- |
| Missing chats or IPC disconnected | Start Desktop; check `CODEX_HOME` and `CODEX_IPC_SOCKET`. |
| Protocol validation error | Capture the error name and versions, without raw chats or credentials. Desktop/CLI versions may be incompatible. |
| Lock screen repeats | Check the password, expiry, HTTPS origin, and secure-cookie setting. |
| Phone cannot connect | Check Tailscale connections, Serve status, host sleep, and local service status. |
| Readiness test cannot launch a browser | Install Google Chrome; tests use `channel: "chrome"`. |
| Readiness test model unavailable | Set `CODEX_MOBILE_SMOKE_MODEL` to a model in your account's picker. |
| Usage/resets unavailable | Keep Desktop open; the host must provide the matching local tools. |
| Voice unavailable | Check HTTPS, speech support, and microphone permissions. |

The installed service sets `FARFIELD_AUTH_COOKIE_SECURE=1`. For temporary local
HTTP diagnosis, setting it to `0` permits HTTP cookies; restore `1` for HTTPS.
Remote debug access is disabled unless explicitly enabled.

## Uninstall

```bash
./scripts/install-user-service.sh uninstall
```

The command removes service definitions and the startup wrapper, retaining
configuration and local state. Review the [privacy inventory](PRIVACY.md) before
removing state. Deleting the session store while the service is stopped revokes
saved PWA sessions. Uninstall does not delete Codex chats or undo Tailscale Serve
configuration; manage Serve separately if you no longer need it.
