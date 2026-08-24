#!/usr/bin/env bash

set -euo pipefail

kino_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kino_app_binary="${KINO_APP_BINARY:-${kino_repo_root}/build/macos/Kino.app/Contents/MacOS/Kino}"
kino_probe_log="$(mktemp /tmp/kino-launch.XXXXXX.log)"
kino_probe_pid=""

cleanup() {
  if [[ -n "${kino_probe_pid}" ]] && kill -0 "${kino_probe_pid}" 2>/dev/null; then
    kill "${kino_probe_pid}"
    wait "${kino_probe_pid}" 2>/dev/null || true
  fi
  rm -f "${kino_probe_log}"
}
trap cleanup EXIT

"${kino_app_binary}" >"${kino_probe_log}" 2>&1 &
kino_probe_pid=$!
sleep 2

if ! kill -0 "${kino_probe_pid}" 2>/dev/null; then
  set +e
  wait "${kino_probe_pid}"
  kino_exit_code=$?
  set -e
  echo "Kino exited during its launch probe with code ${kino_exit_code}."
  sed -n '1,160p' "${kino_probe_log}"
  exit 1
fi

echo "Kino remained healthy through the launch probe."
