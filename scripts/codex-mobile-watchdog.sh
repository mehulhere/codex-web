#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${CODEX_MOBILE_WATCHDOG_SERVICE:-codex-mobile.service}"
BACKEND_URL="${CODEX_MOBILE_WATCHDOG_BACKEND_URL:-http://127.0.0.1:4312/api/health}"
PWA_URL="${CODEX_MOBILE_WATCHDOG_PWA_URL:-http://127.0.0.1:4312/}"
API_BASE_URL="${CODEX_MOBILE_WATCHDOG_API_BASE_URL:-http://127.0.0.1:4312}"
SYSTEMCTL_BIN="${CODEX_MOBILE_WATCHDOG_SYSTEMCTL:-systemctl}"
CURL_BIN="${CODEX_MOBILE_WATCHDOG_CURL:-curl}"
NODE_BIN="${CODEX_MOBILE_WATCHDOG_NODE:-node}"
RETRIES="${CODEX_MOBILE_WATCHDOG_RETRIES:-10}"
RETRY_DELAY_SECONDS="${CODEX_MOBILE_WATCHDOG_RETRY_DELAY_SECONDS:-2}"

service_is_active() {
  "$SYSTEMCTL_BIN" --user is-active --quiet "$SERVICE_NAME"
}

http_status() {
  "$CURL_BIN" \
    --silent \
    --show-error \
    --max-time 5 \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$1"
}

backend_is_healthy() {
  local status
  status="$(http_status "$BACKEND_URL")" || return 1
  [[ "$status" == "200" || "$status" == "401" ]]
}

pwa_is_healthy() {
  [[ "$(http_status "$PWA_URL")" == "200" ]]
}

authenticated_chat_is_healthy() {
  if [[ -z "${FARFIELD_AUTH_PIN:-}" ]]; then
    printf 'codex-mobile-watchdog: FARFIELD_AUTH_PIN is unavailable; cannot test chat loading\n' >&2
    return 1
  fi

  local scratch_dir login_headers thread_list session_cookie login_payload
  local login_status list_status thread_id read_status
  scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-mobile-watchdog.XXXXXX")"
  login_headers="$scratch_dir/login-headers"
  thread_list="$scratch_dir/thread-list.json"

  login_payload="$(
    printf '%s' "$FARFIELD_AUTH_PIN" | "$NODE_BIN" -e '
      let pin = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { pin += chunk; });
      process.stdin.on("end", () => {
        process.stdout.write(JSON.stringify({ pin }));
      });
    '
  )"
  login_status="$(
    printf '%s' "$login_payload" | "$CURL_BIN" \
      --silent \
      --show-error \
      --max-time 5 \
      --dump-header "$login_headers" \
      --output /dev/null \
      --write-out '%{http_code}' \
      --request POST \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      "$API_BASE_URL/api/auth/login"
  )" || {
    rm -rf -- "$scratch_dir"
    return 1
  }
  if [[ "$login_status" != "200" ]]; then
    rm -rf -- "$scratch_dir"
    return 1
  fi

  session_cookie="$(
    awk 'BEGIN { IGNORECASE=1 } /^Set-Cookie:/ {
      sub(/^[^:]+:[[:space:]]*/, "")
      sub(/\r$/, "")
      split($0, parts, ";")
      print parts[1]
      exit
    }' "$login_headers"
  )"
  if [[ -z "$session_cookie" ]]; then
    rm -rf -- "$scratch_dir"
    return 1
  fi

  list_status="$(
    "$CURL_BIN" \
      --silent \
      --show-error \
      --max-time 10 \
      --output "$thread_list" \
      --write-out '%{http_code}' \
      --header "Cookie: $session_cookie" \
      "$API_BASE_URL/api/threads?limit=1"
  )" || list_status="000"

  thread_id=""
  if [[ "$list_status" == "200" ]]; then
    thread_id="$(
      "$NODE_BIN" -e '
        const fs = require("node:fs");
        const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const id = value?.data?.[0]?.id;
        if (typeof id === "string") process.stdout.write(id);
      ' "$thread_list"
    )" || thread_id=""
  fi

  read_status="000"
  if [[ "$list_status" == "200" && -n "$thread_id" ]]; then
    read_status="$(
      "$CURL_BIN" \
        --silent \
        --show-error \
        --max-time 30 \
        --output /dev/null \
        --write-out '%{http_code}' \
        --header "Cookie: $session_cookie" \
        "$API_BASE_URL/api/threads/$thread_id?includeTurns=true"
    )" || read_status="000"
  elif [[ "$list_status" == "200" ]]; then
    read_status="200"
  fi

  "$CURL_BIN" \
    --silent \
    --show-error \
    --max-time 5 \
    --output /dev/null \
    --request POST \
    --header "Cookie: $session_cookie" \
    "$API_BASE_URL/api/auth/logout" >/dev/null 2>&1 || true
  rm -rf -- "$scratch_dir"

  [[ "$list_status" == "200" && "$read_status" == "200" ]]
}

core_failure_components() {
  local components=()
  service_is_active || components+=("service")
  backend_is_healthy || components+=("backend")
  pwa_is_healthy || components+=("pwa")
  local joined
  joined="$(IFS=,; printf '%s' "${components[*]}")"
  printf '%s' "$joined"
}

report_core_health() {
  local failures
  failures="$(core_failure_components)"
  if [[ -n "$failures" ]]; then
    printf 'codex-mobile-watchdog: status=unhealthy components=%s action=restart service=%s\n' \
      "$failures" "$SERVICE_NAME"
    return 1
  fi
  if authenticated_chat_is_healthy; then
    printf 'codex-mobile-watchdog: status=healthy components=all action=none\n'
  else
    printf 'codex-mobile-watchdog: status=degraded component=desktop-chat action=none\n'
  fi
}

if report_core_health; then
  exit 0
fi

"$SYSTEMCTL_BIN" --user restart "$SERVICE_NAME"

for ((attempt = 1; attempt <= RETRIES; attempt += 1)); do
  failures="$(core_failure_components)"
  if [[ -z "$failures" ]]; then
    printf 'codex-mobile-watchdog: status=recovered components=all action=none\n'
    authenticated_chat_is_healthy || \
      printf 'codex-mobile-watchdog: status=degraded component=desktop-chat action=none\n'
    exit 0
  fi
  if ((attempt < RETRIES)); then
    sleep "$RETRY_DELAY_SECONDS"
  fi
done

printf 'codex-mobile-watchdog: status=failed components=%s action=manual-check\n' \
  "${failures:-unknown}" >&2
exit 1
