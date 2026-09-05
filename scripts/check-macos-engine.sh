#!/usr/bin/env bash
#
# Verifies that the shell supervises the bundled streaming engine: starts it,
# learns its loopback URL, and reaches its API.

set -euo pipefail

kino_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kino_app_binary="${KINO_APP_BINARY:-${kino_repo_root}/build/macos/Kino.app/Contents/MacOS/Kino}"

if [[ ! -x "$(dirname "${kino_app_binary}")/kino-stream-engine" ]]; then
  echo "No streaming engine is bundled. Run \"pnpm engine:build\" then \"pnpm macos:build\"." >&2
  exit 1
fi

kino_probe_output="$(KINO_ENGINE_PROBE=1 "${kino_app_binary}" 2>/dev/null |
  grep -m 1 '^KINO_ENGINE_PROBE_RESULT ' || true)"
kino_engine_url="${kino_probe_output#KINO_ENGINE_PROBE_RESULT }"

if [[ -z "${kino_engine_url}" || "${kino_engine_url}" == error:* ]]; then
  echo "The shell could not start the streaming engine. Check Kino's diagnostic log." >&2
  exit 1
fi
if [[ ! "${kino_engine_url}" =~ ^http://127\.0\.0\.1:[0-9]+$ ]]; then
  echo "The engine probe did not return a sanitized loopback address." >&2
  exit 1
fi

echo "The shell started the streaming engine on ${kino_engine_url}."
