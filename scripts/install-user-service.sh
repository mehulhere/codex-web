#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/codex-mobile"
ENVIRONMENT_FILE="$CONFIG_DIR/environment"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
USER_UNIT_PATH="$USER_UNIT_DIR/codex-mobile.service"
SERVICE_TEMPLATE="$PROJECT_DIR/systemd/codex-mobile.service"
WATCHDOG_SERVICE_PATH="$USER_UNIT_DIR/codex-mobile-watchdog.service"
WATCHDOG_SERVICE_TEMPLATE="$PROJECT_DIR/systemd/codex-mobile-watchdog.service"
WATCHDOG_TIMER_PATH="$USER_UNIT_DIR/codex-mobile-watchdog.timer"
WATCHDOG_TIMER_TEMPLATE="$PROJECT_DIR/systemd/codex-mobile-watchdog.timer"
START_COMMAND="$HOME/.local/bin/start-codex-pwa"

install_service() {
  pnpm_path="$(command -v pnpm)"
  codex_path="$(command -v codex || true)"
  if [[ -z "$codex_path" ]]; then
    for candidate in "$HOME"/.nvm/versions/node/*/bin/codex; do
      if [[ -x "$candidate" ]]; then
        codex_path="$candidate"
      fi
    done
  fi
  if [[ -z "$codex_path" ]]; then
    printf 'codex executable not found; install Codex or add it to PATH\n' >&2
    exit 1
  fi
  node_path="$(command -v node)"
  tool_path="$(dirname "$pnpm_path"):$(dirname "$codex_path"):$(dirname "$node_path"):/usr/local/bin:/usr/bin"
  mkdir -p "$CONFIG_DIR" "$USER_UNIT_DIR"

  if [[ ! -f "$ENVIRONMENT_FILE" ]]; then
    generated_pin="${CODEX_MOBILE_PIN:-$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')}"
    generated_pin="$(printf '%08d' "$((generated_pin % 100000000))")"
    printf 'FARFIELD_AUTH_PIN=%s\nFARFIELD_REMOTE_DEBUG_ENABLED=0\nFARFIELD_AUTH_COOKIE_SECURE=1\n' "$generated_pin" > "$ENVIRONMENT_FILE"
    printf 'Codex Mobile PIN: %s\n' "$generated_pin"
  fi
  if ! grep -q '^FARFIELD_AUTH_COOKIE_SECURE=' "$ENVIRONMENT_FILE"; then
    printf 'FARFIELD_AUTH_COOKIE_SECURE=1\n' >> "$ENVIRONMENT_FILE"
  fi
  chmod 600 "$ENVIRONMENT_FILE"

  printf 'Building Codex Mobile before installing the persistent service\n'
  (
    cd "$PROJECT_DIR"
    "$pnpm_path" build
  )

  sed \
    -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
    -e "s|__NODE_PATH__|$node_path|g" \
    -e "s|__TOOL_PATH__|$tool_path|g" \
    "$SERVICE_TEMPLATE" > "$USER_UNIT_PATH"
  sed \
    -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
    -e "s|__TOOL_PATH__|$tool_path|g" \
    "$WATCHDOG_SERVICE_TEMPLATE" > "$WATCHDOG_SERVICE_PATH"
  cp "$WATCHDOG_TIMER_TEMPLATE" "$WATCHDOG_TIMER_PATH"
  mkdir -p "$(dirname "$START_COMMAND")"
  printf '#!/usr/bin/env bash\nexport PATH=%q\nexec %q "$@"\n' \
    "$tool_path" "$PROJECT_DIR/scripts/start-codex-pwa.sh" > "$START_COMMAND"
  chmod 700 "$START_COMMAND"
  systemctl --user daemon-reload
  systemctl --user enable codex-mobile.service
  systemctl --user restart codex-mobile.service
  systemctl --user enable --now codex-mobile-watchdog.timer
  systemctl --user --no-pager status codex-mobile.service
  systemctl --user --no-pager status codex-mobile-watchdog.timer
  "$START_COMMAND" --verify-only
}

uninstall_service() {
  systemctl --user disable --now codex-mobile-watchdog.timer 2>/dev/null || true
  systemctl --user disable --now codex-mobile.service 2>/dev/null || true
  rm -f "$USER_UNIT_PATH" "$WATCHDOG_SERVICE_PATH" "$WATCHDOG_TIMER_PATH" "$START_COMMAND"
  systemctl --user daemon-reload
  printf 'Service removed. Configuration retained at %s\n' "$CONFIG_DIR"
}

case "${1:-install}" in
  install) install_service ;;
  uninstall) uninstall_service ;;
  status) systemctl --user --no-pager status codex-mobile.service ;;
  *) printf 'Usage: %s [install|uninstall|status]\n' "$0" >&2; exit 2 ;;
esac
