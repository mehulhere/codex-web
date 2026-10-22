# Contributing

Thank you for helping make the browser client more reliable.

## Before making a change

- Read the [README](README.md), [configuration](docs/CONFIGURATION.md), and nearby
  source. Keep changes focused and preserve protocol validation.
- Use Node.js 24+ and the pnpm version pinned in `package.json`.
- Keep tests synthetic. Never submit chats, credentials, project names, local
  machine addresses, real screenshots, or raw diagnostic captures.
- Describe the affected Desktop/CLI versions in a compatibility report. Version
  numbers are useful; account identities and chat contents are not.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm check:public
```

Add a focused regression test for behavior changes. Exercise user-visible
changes in a browser. Live sending tests are optional for contributors without
Codex access, but say clearly when they were not run. Never use a working chat
for tests or redeem a real reset as a test.

Keep API boundaries validated with Zod, preserve existing package ownership, and
report protocol mismatches explicitly. Avoid dependencies or abstractions that
do not solve a demonstrated need.

## Pull requests

Explain the user-visible change, tests run, and any configuration changes. Use
synthetic screenshots only. Check both the diff and new files before committing.
Contributions are provided under the repository's MIT license.

For security issues, follow [SECURITY.md](SECURITY.md) instead of posting private
information in an issue.
