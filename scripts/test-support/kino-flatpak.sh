#!/usr/bin/env bash
#
# Runs the installed Flatpak in place of a built Kino, so the desktop probes
# can check the shipped package: point KINO_APP_BINARY here. The probe's
# KINO_* and QTWEBENGINE_* settings are handed into the sandbox.
#
# WebEngine's sandboxes, which the desktop portal starts, inherit Kino's stderr
# and outlive a killed Kino, so a probe reading that pipe would never see it
# close. Kino writes to a file instead, followed for exactly as long as Kino
# runs, and a stop signal reaches Kino as it would without this script.

set -uo pipefail

kino_arguments=()
while IFS= read -r kino_name; do
  kino_arguments+=("--env=${kino_name}=${!kino_name}")
done < <(env | sed -n 's/^\(KINO_[A-Z_]*\|QTWEBENGINE_[A-Z_]*\)=.*/\1/p')

kino_log="$(mktemp "${TMPDIR:-/tmp}/kino-flatpak.XXXXXX")"
# XDG_DATA_HOME is left to the sandbox, which keeps Kino's data under
# ~/.var/app; a probe that reads that data sets it to point there.
env -u XDG_DATA_HOME flatpak run --die-with-parent --filesystem=/tmp --filesystem=home \
  "${kino_arguments[@]}" com.chriscorbell.Kino 2>"${kino_log}" &
kino_pid=$!
trap 'kill -TERM "${kino_pid}"' TERM INT
tail -n +1 -f --pid="${kino_pid}" "${kino_log}" >&2 &
kino_follower=$!
wait "${kino_pid}"
kino_status=$?
# A forwarded signal interrupts the first wait; the second collects Kino.
if kill -0 "${kino_pid}" 2>/dev/null; then
  wait "${kino_pid}"
  kino_status=$?
fi
wait "${kino_follower}"
rm -f "${kino_log}"
exit "${kino_status}"
