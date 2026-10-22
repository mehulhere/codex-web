# Agent guidance

Codex Web is the public source for the Codex Mobile PWA, derived from Farfield.
Read README.md and CONTRIBUTING.md before changes.

- Keep protocol boundaries validated with Zod and report mismatches explicitly.
- Inspect source before editing and preserve unrelated work.
- Use synthetic fixtures, reserved example domains, and generic paths.
- Never commit local configuration, credentials, chats, projects, raw traces,
  browser reports, or screenshots of real users.
- Run focused tests and type checks; exercise UI changes in a browser.
- Run pnpm check:public and inspect the diff before a public push.
- Live startup verification uses start-codex-pwa, including real send/resume and
  queue checks in its registered isolated chat. Never substitute a working chat.
- Preserve upstream license notices. Do not publish private Git history.
