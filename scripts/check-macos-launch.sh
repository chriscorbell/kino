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

# An instance name of the probe's own keeps a Kino already open for this
# profile from taking over the launch.
kino_instance_name="kino-launch-probe-$$"
KINO_INSTANCE_NAME="${kino_instance_name}" "${kino_app_binary}" >"${kino_probe_log}" 2>&1 &
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

# A second launch for the same profile hands over to the first and exits.
set +e
KINO_INSTANCE_NAME="${kino_instance_name}" "${kino_app_binary}" >/dev/null 2>&1 &
kino_second_pid=$!
for _ in $(seq 1 50); do
  kill -0 "${kino_second_pid}" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "${kino_second_pid}" 2>/dev/null; then
  kill "${kino_second_pid}"
  echo "A second launch kept running beside the first."
  exit 1
fi
wait "${kino_second_pid}"
kino_second_exit=$?
set -e
if [[ "${kino_second_exit}" -ne 0 ]]; then
  echo "A second launch exited with code ${kino_second_exit} instead of handing over."
  exit 1
fi
for _ in $(seq 1 20); do
  grep -q "brought forward by a second launch" "${kino_probe_log}" && break
  sleep 0.1
done
if ! grep -q "brought forward by a second launch" "${kino_probe_log}" || ! kill -0 "${kino_probe_pid}" 2>/dev/null; then
  echo "The first Kino was not brought forward by the second launch."
  sed -n '1,80p' "${kino_probe_log}"
  exit 1
fi
echo "A second launch brought the first Kino forward and exited."
