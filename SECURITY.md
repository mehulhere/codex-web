# Security

Codex Web controls a locally authenticated Codex installation. A user with a
valid PWA session may send prompts, read chats, access attachments, and act with
the permissions of the underlying chat. Keep access limited to trusted devices.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** for private reports in this
repository. Do not put credentials, real chat contents, working project paths,
or raw traffic in public issues. Include a minimal synthetic reproduction,
affected versions, and the expected versus observed access boundary.

If private reporting is unavailable, open a public issue requesting a private
contact channel without disclosing the vulnerability or sensitive data.

## Deployment boundaries

- Use private HTTPS access such as Tailscale Serve and keep remote debug off.
- Do not expose development ports or the control server directly to the internet.
- Protect the environment file, host state, backups, and authenticated browsers.
- Review Codex chat permissions; the PWA does not create an additional execution
  sandbox or reduce the permissions of a chat.
- Keep dependencies and your Codex installation up to date; verify compatibility
  after changes to Desktop or app-server interfaces.

The project is provided under the MIT license without a security or availability
SLA. See [Privacy](docs/PRIVACY.md) for stored data and diagnostic handling.
