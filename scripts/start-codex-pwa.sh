#!/usr/bin/env bash
set -euo pipefail
umask 077

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/codex-mobile/environment"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/codex-mobile"
ACTION="start"
case "${1:-}" in
  --restart) ACTION="restart"; shift ;;
  --verify-only) ACTION="verify"; shift ;;
esac
for argument in "$@"; do
  if [[ "$argument" == "--read-only" ]]; then
    printf 'Startup readiness requires the send-and-resume test. Use test:pwa for read-only diagnostics.\n' >&2
    exit 2
  fi
done
if [[ ! -r "$CONFIG_FILE" ]]; then
  printf 'Missing Codex Mobile configuration: %s\n' "$CONFIG_FILE" >&2
  exit 1
fi
set -a
source "$CONFIG_FILE"
set +a
mkdir -p "$STATE_DIR"
exec 9> "$STATE_DIR/start.lock"
flock -n 9 || { printf 'Another PWA readiness check is already running.\n' >&2; exit 1; }

if [[ "$ACTION" == "verify" ]]; then
  systemctl --user is-active --quiet codex-mobile.service
else
  systemctl --user "$ACTION" codex-mobile.service
fi
printf 'Waiting for the PWA listener, then checking the browser...\n'
curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 1 \
  --retry-max-time 30 --max-time 2 --output /dev/null \
  http://127.0.0.1:4312/api/auth/session
if ! node "$PROJECT_DIR/scripts/pwa-smoke-test.mjs" "$@"; then
  printf 'Codex PWA is NOT READY: browser verification failed.\n' >&2
  exit 1
fi
if ! node "$PROJECT_DIR/scripts/pwa-queue-test.mjs"; then
  printf 'Codex PWA is NOT READY: real queue verification failed.\n' >&2
  exit 1
fi
printf 'Codex PWA is READY: send, reply, reload, resume, and real queue checks passed.\n'
